// tools/check-page.sh against a stand-in app: a local HTTP server that answers `/` and /setup as
// the test says, as a fresh installation of the image does (or, broken, would not).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

const SCRIPT = join(import.meta.dirname, "check-page.sh");

/** What the stand-in answers on a path. */
type Answer = { status: number; location?: string; body?: string };

/** What tools/check-page.sh did: its exit status and what it printed. */
type ScriptRun = { status: number | null; out: string; err: string };

/** /setup as the app draws it, cut to what the check reads. */
const SETUP_PAGE =
  '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>Gousset</title></head>' +
  "<body><h1>Welcome to Gousset</h1></body></html>";

/** `/` on a fresh installation: TanStack Start's redirect, thrown by the `_authed` guard. */
const TO_SETUP: Answer = { status: 307, location: "/setup" };

const servers: Array<Server> = [];

/** A server on TCP has an address of its own, an object; only a pipe's is a string. */
function onTcp(address: string | AddressInfo | null): address is AddressInfo {
  return address !== null && Object(address) === address;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/** Starts a stand-in answering each path from `answers` (404 elsewhere); gives its address. */
async function standIn(answers: Map<string, Answer>): Promise<string> {
  const server = createServer((request, response) => {
    const answer = answers.get(request.url ?? "") ?? { status: 404, body: "Not Found" };

    response.statusCode = answer.status;

    if (answer.location !== undefined) {
      response.setHeader("Location", answer.location);
    }

    response.end(answer.body ?? "");
  });

  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!onTcp(address)) {
    throw new Error("The stand-in is not listening on TCP.");
  }

  return `http://127.0.0.1:${address.port}`;
}

/** Runs the script on an address; asynchronous, so that the stand-in in this process answers. */
async function checkPage(address: string): Promise<ScriptRun> {
  const child = spawn(SCRIPT, [address], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";

  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });

  const status = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });

  return { status, out, err };
}

describe("tools/check-page.sh", () => {
  it("passes when / redirects to /setup and /setup is Gousset's page", async () => {
    const address = await standIn(
      new Map([
        ["/", TO_SETUP],
        ["/setup", { status: 200, body: SETUP_PAGE }],
      ]),
    );

    const result = await checkPage(address);

    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    expect(result.out).toContain("/ redirects to /setup");
  });

  it("takes a redirect to /setup named with a host of its own", async () => {
    const address = await standIn(
      new Map([
        ["/", { status: 302, location: "http://localhost:3901/setup" }],
        ["/setup", { status: 200, body: SETUP_PAGE }],
      ]),
    );

    expect((await checkPage(address)).status).toBe(0);
  });

  it("fails when / answers a page without redirecting: a fresh installation has no session", async () => {
    const address = await standIn(
      new Map([
        ["/", { status: 200, body: SETUP_PAGE }],
        ["/setup", { status: 200, body: SETUP_PAGE }],
      ]),
    );

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("/ answered 200, not a redirect to /setup");
  });

  it("fails when / redirects elsewhere than /setup", async () => {
    const address = await standIn(
      new Map([
        ["/", { status: 307, location: "/sign-in" }],
        ["/setup", { status: 200, body: SETUP_PAGE }],
      ]),
    );

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("not to /setup");
  });

  it("fails when / redirects nowhere", async () => {
    const address = await standIn(new Map([["/", { status: 307 }]]));

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("not to /setup");
  });

  it("fails when / answers an error", async () => {
    const address = await standIn(new Map([["/", { status: 500, body: "Internal Server Error" }]]));

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("/ answered 500");
  });

  it("fails when /setup is not Gousset's page", async () => {
    const address = await standIn(
      new Map([
        ["/", TO_SETUP],
        ["/setup", { status: 200, body: "<html><head><title>Welcome</title></head></html>" }],
      ]),
    );

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("/setup is not Gousset's page");
  });

  it("fails when /setup answers anything but 200, even Gousset's page", async () => {
    const address = await standIn(
      new Map([
        ["/", TO_SETUP],
        ["/setup", { status: 307, location: "/sign-in", body: SETUP_PAGE }],
      ]),
    );

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("/setup answered 307, not 200");
  });

  it("fails when nothing answers", async () => {
    const address = await standIn(new Map());

    // The stand-in's port, closed: nothing listens there any more.
    await new Promise<void>((resolve) => {
      servers[0]?.close(() => resolve());
    });

    const result = await checkPage(address);

    expect(result.status).toBe(1);
    expect(result.err).toContain("/ did not answer");
  });
});
