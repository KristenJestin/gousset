import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";

import { request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { deleteReceipt, lineReceipts, receiptStorageLayer, sweepReceipts } from "@gousset/core";
import type { ReceiptStorage } from "@gousset/core";
import {
  account,
  entryPart,
  entrySubject,
  lineAttachment,
  statementLine,
  subject,
} from "@gousset/db/schema/ledger";
import type { UserData } from "@gousset/db/user-data";
import { eq, notInArray } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { strToU8, unzipSync } from "fflate";

import { receiptsDirectory } from "../src/app-server";
import type { TestUser } from "../src/auth";
import { readArchive } from "../src/export";
import { addUser, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #217, receipts: a photo or a PDF attached to any line, its file on disk in the
// installation's receipts directory, never in Postgres; a subject's receipts in one zip; the
// installation's limits, read when the app starts, refused with the limit named; each user's
// receipts unreachable by any other; the export holding the files. This file's app takes receipts
// of 1 MB at most, so that a file over the limit is small to send, and so that the limit is proved
// to be the one the app was started with, not the build's default of 50 MB (#244, #245).
test.use({ appEnvironment: { RECEIPT_MAX_MB: "1" } });

const MEGABYTE = 1_000_000;

/** Invented receipts: each kind's signature, then bytes of nothing in particular. */
function madeUpFile(signature: Uint8Array, size: number, seed: number): Buffer {
  const file = Buffer.alloc(size);

  file.set(signature);

  for (let at = signature.length; at < size; at += 1) {
    file[at] = (at * 31 + seed) % 256;
  }

  return file;
}

const PDF = strToU8("%PDF-1.7\n");
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
const GIF = strToU8("GIF89a");

const Uploaded = Schema.Struct({
  receipt: Schema.Struct({
    id: Schema.String,
    lineId: Schema.String,
    fileName: Schema.String,
    mediaType: Schema.String,
    size: Schema.Number,
  }),
});

type Owner = { person: TestUser; owner: string; http: APIRequestContext };

/** A user of the test's own, holding the made-up data, and their browser's requests, signed in. */
async function personWithData(
  app: { baseURL: string; database: string },
  admin: TestUser,
  local: string,
): Promise<Owner> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));
  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    await data.seed(owner);

    const http = await request.newContext({
      baseURL: app.baseURL,
      storageState: { cookies: [...person.cookies], origins: [] },
    });

    return { person, owner, http };
  } finally {
    await data.close();
  }
}

/**
 * A POST whose body comes in chunks with no `Content-Length`, as a stream is sent: the server
 * cannot know its size before reading it. Its status, and its JSON.
 */
function postChunked(
  url: string,
  options: { method: "POST"; headers: Record<string, string>; body: Buffer },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sending = httpRequest(
      url,
      { method: options.method, headers: options.headers },
      (answer) => {
        const chunks: Array<Buffer> = [];

        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () =>
          resolve({ status: answer.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );

    // A connection cut before the answer fails the test: the server reads a refused body to its
    // end, so that its client gets the answer.
    sending.on("error", reject);

    for (let at = 0; at < options.body.length; at += 64 * 1024) {
      sending.write(options.body.subarray(at, at + 64 * 1024));
    }

    sending.end();
  });
}

/** Uploads `content` as `name` to `lineId`, as a page does. */
function upload(http: APIRequestContext, lineId: string, name: string, content: Buffer) {
  return http.post(`/api/lines/${lineId}/receipts?${new URLSearchParams({ name }).toString()}`, {
    headers: { "Content-Type": "application/octet-stream" },
    data: content,
  });
}

async function attached(http: APIRequestContext, lineId: string, name: string, content: Buffer) {
  const answer = await upload(http, lineId, name, content);

  expect(answer.status(), await answer.text()).toBe(200);

  return Schema.decodeUnknownSync(Uploaded)(await answer.json()).receipt;
}

/** The user's subject "Van" (the seed's), and the lines its expense is paid by; and a line of none. */
async function vanAndLines(database: string, owner: string) {
  const data = openUserData(database);

  try {
    return await data.asUser(owner, async (each) => {
      const [van] = await each
        .select({ id: subject.id })
        .from(subject)
        .where(eq(subject.name, "Van"));

      const ofVan = await each
        .select({ lineId: entryPart.lineId })
        .from(entryPart)
        .innerJoin(entrySubject, eq(entrySubject.entryId, entryPart.entryId))
        .where(eq(entrySubject.subjectId, van?.id ?? ""));

      const [elsewhere] = await each
        .select({ id: statementLine.id })
        .from(statementLine)
        .where(
          notInArray(
            statementLine.id,
            ofVan.map((part) => part.lineId),
          ),
        )
        .limit(1);

      if (van === undefined || ofVan[0] === undefined || elsewhere === undefined) {
        throw new Error("The seed gave no subject Van with a line, or no other line.");
      }

      return { van: van.id, line: ofVan[0].lineId, otherLine: elsewhere.id };
    });
  } finally {
    await data.close();
  }
}

/** Runs core logic on the worker's database and receipts' directory, as the app does. */
async function onTheApp<A, E>(
  database: string,
  effect: Effect.Effect<A, E, UserData | ReceiptStorage>,
): Promise<A> {
  const data = openUserData(database);
  const layer = Layer.mergeAll(data.layer, receiptStorageLayer(receiptsDirectory(database)));

  try {
    return await Effect.runPromise(Effect.provide(effect, layer));
  } finally {
    await data.close();
  }
}

/** The names of the files in `owner`'s folder of the receipts directory. */
async function filesOf(database: string, owner: string): Promise<ReadonlyArray<string>> {
  const folder = join(receiptsDirectory(database), Buffer.from(owner).toString("base64url"));

  return existsSync(folder) ? readdir(folder) : [];
}

/** The seed's own receipt: its row alone, with no file on disk. */
const SEEDED = "seeded-receipt.pdf";

test("a receipt attached to a line is listed", async ({ app, user }) => {
  const kim = await personWithData(app, user, "kim");

  try {
    const { line } = await vanAndLines(app.database, kim.owner);
    const content = madeUpFile(PDF, 20_000, 1);
    const receipt = await attached(kim.http, line, "fuel-october.pdf", content);

    expect(receipt).toMatchObject({
      lineId: line,
      fileName: "fuel-october.pdf",
      mediaType: "application/pdf",
      size: 20_000,
    });

    // Listed with the line, as its detail reads it.
    const listed = await onTheApp(app.database, lineReceipts(kim.owner, line));

    expect(listed.filter((each) => each.fileName !== SEEDED).map((each) => each.id)).toEqual([
      receipt.id,
    ]);

    // Downloaded as it was attached, saved as a file under its own name.
    const download = await kim.http.get(`/api/receipts/${receipt.id}`);

    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toBe("application/pdf");
    expect(download.headers()["content-disposition"]).toContain("fuel-october.pdf");
    expect(Buffer.from(await download.body()).equals(content)).toBe(true);

    // On disk, in the user's folder of the receipts directory, under a name of the app's.
    const files = await filesOf(app.database, kim.owner);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
  } finally {
    await kim.http.dispose();
  }
});

test("a subject's zip holds every receipt of its lines", async ({ app, user }) => {
  const lou = await personWithData(app, user, "lou");

  try {
    const { van, line, otherLine } = await vanAndLines(app.database, lou.owner);
    const fuel = madeUpFile(JPEG, 30_000, 2);
    const again = madeUpFile(JPEG, 31_000, 3);
    const invoice = madeUpFile(PDF, 12_000, 4);

    await attached(lou.http, line, "fuel.jpg", fuel);
    await attached(lou.http, line, "fuel.jpg", again);
    await attached(lou.http, line, "invoice.pdf", invoice);
    // A line none of the van's expenses comes from: not in its zip.
    await attached(lou.http, otherLine, "groceries.pdf", madeUpFile(PDF, 5000, 5));

    const answer = await lou.http.get(`/api/subjects/${van}/receipts`);

    expect(answer.status()).toBe(200);
    expect(answer.headers()["content-type"]).toBe("application/zip");
    expect(answer.headers()["content-disposition"]).toContain("Van - receipts.zip");

    const zipped = unzipSync(new Uint8Array(await answer.body()));
    const names = Object.keys(zipped).toSorted();

    expect(names).toHaveLength(3);
    expect(names.every((name) => /^\d{4}-\d{2}-\d{2} /.test(name))).toBe(true);
    expect(names.some((name) => name.includes("groceries"))).toBe(false);

    const contents = Object.values(zipped).map((each) => Buffer.from(each));

    for (const file of [fuel, again, invoice]) {
      expect(contents.some((each) => each.equals(file))).toBe(true);
    }

    // Two of one name stay two.
    expect(names.filter((name) => name.endsWith("fuel.jpg"))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith("fuel (2).jpg"))).toHaveLength(1);
  } finally {
    await lou.http.dispose();
  }
});

test("a too large file and a wrong type are refused with the message naming the limit", async ({
  app,
  user,
}) => {
  const max = await personWithData(app, user, "max");

  try {
    const { line } = await vanAndLines(app.database, max.owner);

    // Over the 1 MB this app was started with: its size and the limit, for the page to say.
    const tooLarge = await upload(max.http, line, "scan.pdf", madeUpFile(PDF, 1_500_000, 6));

    expect(tooLarge.status()).toBe(413);
    expect(await tooLarge.json()).toEqual({
      refused: "RECEIPT_TOO_LARGE",
      bytes: 1_500_000,
      limit: MEGABYTE,
    });

    // Sent without its size, as a stream: cut at the limit, never read whole.
    const streamed = await postChunked(`${app.baseURL}/api/lines/${line}/receipts?name=scan.pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        Cookie: max.person.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      },
      body: madeUpFile(PDF, 1_800_000, 7),
    });

    expect(streamed.status).toBe(413);
    expect(streamed.body).toBe(
      JSON.stringify({ refused: "RECEIPT_TOO_LARGE", bytes: null, limit: MEGABYTE }),
    );

    // A GIF named like a PDF and said to be one: its bytes say what it is.
    const wrong = await upload(max.http, line, "receipt.pdf", madeUpFile(GIF, 4000, 8));

    expect(wrong.status()).toBe(415);
    expect(await wrong.json()).toEqual({
      refused: "RECEIPT_TYPE",
      allowed: ["pdf", "jpeg", "png", "heic"],
    });

    const empty = await upload(max.http, line, "empty.pdf", Buffer.alloc(0));

    expect(empty.status()).toBe(422);
    expect(await empty.json()).toEqual({ refused: "RECEIPT_EMPTY" });

    // Nothing of them was kept, neither a row nor a file, nor a file half written.
    const listed = await onTheApp(app.database, lineReceipts(max.owner, line));

    expect(listed.filter((each) => each.fileName !== SEEDED)).toEqual([]);
    expect(await filesOf(app.database, max.owner)).toEqual([]);
  } finally {
    await max.http.dispose();
  }
});

test("another user's attachment is unreachable", async ({ app, user }) => {
  const ana = await personWithData(app, user, "ana");
  const ben = await personWithData(app, user, "ben");

  try {
    const anas = await vanAndLines(app.database, ana.owner);
    const receipt = await attached(ana.http, anas.line, "private.pdf", madeUpFile(PDF, 8000, 9));

    // Ben names Ana's receipt, line and subject: each is what an unknown one is.
    const download = await ben.http.get(`/api/receipts/${receipt.id}`);

    expect(download.status()).toBe(404);
    expect(await download.json()).toEqual({ refused: "RECEIPT_NOT_FOUND" });

    const onHerLine = await upload(ben.http, anas.line, "mine.pdf", madeUpFile(PDF, 3000, 10));

    expect(onHerLine.status()).toBe(404);
    expect(await onHerLine.json()).toEqual({ refused: "LINE_NOT_FOUND" });

    const zip = await ben.http.get(`/api/subjects/${anas.van}/receipts`);

    expect(zip.status()).toBe(404);
    expect(await zip.json()).toEqual({ refused: "SUBJECT_NOT_FOUND" });

    // Without a session, nothing at all.
    const anonymous = await request.newContext({ baseURL: app.baseURL });

    try {
      expect((await anonymous.get(`/api/receipts/${receipt.id}`)).status()).toBe(401);
      expect((await anonymous.get(`/api/subjects/${anas.van}/receipts`)).status()).toBe(401);
      expect((await upload(anonymous, anas.line, "x.pdf", madeUpFile(PDF, 100, 11))).status()).toBe(
        401,
      );
    } finally {
      await anonymous.dispose();
    }

    // Ana still has it, whole.
    expect((await ana.http.get(`/api/receipts/${receipt.id}`)).status()).toBe(200);
  } finally {
    await ana.http.dispose();
    await ben.http.dispose();
  }
});

test("the export holds the files", async ({ app, user }) => {
  const eva = await personWithData(app, user, "eva");

  try {
    const { line } = await vanAndLines(app.database, eva.owner);
    const content = madeUpFile(JPEG, 40_000, 12);
    const receipt = await attached(eva.http, line, "toll.jpg", content);

    const answer = await eva.http.get("/api/export");

    expect(answer.status()).toBe(200);

    const archive = readArchive(new Uint8Array(await answer.body()));
    const path = `receipt-files/${receipt.id}/toll.jpg`;

    expect(Buffer.from(archive.files[path] ?? new Uint8Array()).equals(content)).toBe(true);
    expect(archive.manifest.files.some((file) => file.path === path)).toBe(true);
    expect(archive.texts("line-attachments", "id")).toContain(receipt.id);
  } finally {
    await eva.http.dispose();
  }
});

test("a receipt deleted, or its line, takes its file with it", async ({ app, user }) => {
  const ivy = await personWithData(app, user, "ivy");
  const data = openUserData(app.database);

  try {
    const { line } = await vanAndLines(app.database, ivy.owner);

    // A line entered by hand, which nothing else refers to, deleted below as an undo would.
    const [entered] = await data.asUser(ivy.owner, async (each) => {
      const [first] = await each.select({ id: account.id }).from(account).limit(1);

      return each
        .insert(statementLine)
        .values({
          userId: ivy.owner,
          accountId: first?.id ?? "",
          source: "manual",
          state: "discarded",
          bookedOn: "2026-10-21",
          amountMinor: -1500,
          label: "MADE-UP PARKING",
        })
        .returning({ id: statementLine.id });
    });

    const otherLine = entered?.id ?? "";
    const kept = await attached(ivy.http, line, "kept.pdf", madeUpFile(PDF, 2000, 13));
    const deleted = await attached(ivy.http, line, "deleted.pdf", madeUpFile(PDF, 2000, 14));
    const onLineGone = await attached(ivy.http, otherLine, "gone.pdf", madeUpFile(PDF, 2000, 15));

    const storedNames = async () =>
      new Map(
        (
          await data.asUser(ivy.owner, (each) =>
            each
              .select({ id: lineAttachment.id, storedName: lineAttachment.storedName })
              .from(lineAttachment),
          )
        ).map((row) => [row.id, row.storedName]),
      );

    const onDisk = async () => new Set(await filesOf(app.database, ivy.owner));
    const before = await storedNames();

    expect((await onDisk()).size).toBe(3);

    // Deleted by its user: its file goes at once.
    await onTheApp(app.database, deleteReceipt(ivy.owner, deleted.id));
    expect((await onDisk()).has(before.get(deleted.id) ?? "")).toBe(false);
    expect((await ivy.http.get(`/api/receipts/${deleted.id}`)).status()).toBe(404);

    // A line deleted (an undone import, an account or a user deleted) takes its receipts' rows;
    // their files go with the next sweep, an hour old or more.
    await data.asUser(ivy.owner, (each) =>
      each.delete(statementLine).where(eq(statementLine.id, otherLine)),
    );

    await onTheApp(app.database, sweepReceipts(new Date()));
    expect((await onDisk()).has(before.get(onLineGone.id) ?? "")).toBe(true);

    await onTheApp(app.database, sweepReceipts(new Date(Date.now() + 2 * 60 * 60_000)));

    const after = await onDisk();

    expect(after.has(before.get(onLineGone.id) ?? "")).toBe(false);
    expect(after.has(before.get(kept.id) ?? "")).toBe(true);
  } finally {
    await data.close();
    await ivy.http.dispose();
  }
});
