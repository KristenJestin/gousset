import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { bytesOf } from "../zip-stream";
import { zipPaths } from "./attachments";
import { ReceiptStorageFailed, ReceiptTooLarge } from "./errors";
import { ReceiptStorage, newStoredName, receiptStorageLayer } from "./storage";

// The receipts' directory (#217) on a folder of the test's own: what is written, refused and
// removed, and that no user's id nor file name makes a path outside it.

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "gousset-receipts-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

type Files = typeof ReceiptStorage.Service;

const withFiles = <A, E>(work: (files: Files) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* work(yield* ReceiptStorage);
  }).pipe(Effect.provide(receiptStorageLayer(directory)));

const run = <A, E>(work: (files: Files) => Effect.Effect<A, E>) =>
  Effect.runPromise(withFiles(work));

const failure = <A, E>(work: (files: Files) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(withFiles(work)));

/** A body sent in chunks, as a request's arrives. */
function body(...chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }

      controller.close();
    },
  });
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("the receipts' directory", () => {
  test("a file written is read back whole, and its first bytes are given", async () => {
    const name = newStoredName();

    const written = await run((files) =>
      files.write("user-1", name, body("%PDF-", "1.7 made up"), 1000),
    );

    expect(written.bytes).toBe(16);
    expect(text(written.head)).toBe("%PDF-1.7 made up");
    expect(text(await run((files) => files.read("user-1", name)))).toBe("%PDF-1.7 made up");
    expect(text(await bytesOf(await run((files) => files.open("user-1", name))))).toBe(
      "%PDF-1.7 made up",
    );
  });

  test("past its limit a file is cut, and nothing of it stays", async () => {
    const refused = await failure((files) =>
      files.write("user-1", newStoredName(), body("12345", "67890"), 8),
    );

    expect(refused).toBeInstanceOf(ReceiptTooLarge);
    expect(refused).toMatchObject({ bytes: null, limit: 8 });
    expect(await run((files) => files.list("user-1"))).toEqual([]);
  });

  test("each user has a folder of their own, which no id turns into a path", async () => {
    const owners = ["user-1", "../user-2", "/etc", "."];

    for (const owner of owners) {
      await run((files) => files.write(owner, newStoredName(), body("x"), 10));
    }

    const folders = await readdir(directory);

    expect(folders).toHaveLength(4);
    expect(folders.every((folder) => /^[\w-]+$/.test(folder))).toBe(true);
    expect((await run((files) => files.owners())).toSorted()).toEqual(owners.toSorted());
  });

  test("a name the app did not make is refused: no path escapes the directory", async () => {
    for (const name of ["../../etc/passwd", "..", "", "receipt.pdf", `${newStoredName()}/x`]) {
      const refused = await failure((files) => files.write("user-1", name, body("x"), 10));

      expect(refused, name).toBeInstanceOf(ReceiptStorageFailed);
      expect(refused, name).toMatchObject({ code: "INVALID_PATH" });
      expect(await failure((files) => files.read("user-1", name)), name).toMatchObject({
        code: "INVALID_PATH",
      });
    }

    expect(await readdir(directory)).toEqual([]);
  });

  test("a file removed is gone, once or twice, and an empty folder goes with it", async () => {
    const name = newStoredName();

    await run((files) => files.write("user-1", name, body("x"), 10));
    await run((files) => files.remove("user-1", name));
    await run((files) => files.remove("user-1", name));
    await run((files) => files.removeFolder("user-1"));

    expect(await readdir(directory)).toEqual([]);
    expect(await failure((files) => files.read("user-1", name))).toMatchObject({ code: "ENOENT" });
  });
});

describe("the names inside a subject's zip", () => {
  test("each is its line's day and its own name, a second of a name numbered", () => {
    expect(
      zipPaths([
        { bookedOn: "2026-10-14", fileName: "fuel.jpg" },
        { bookedOn: "2026-10-14", fileName: "fuel.jpg" },
        { bookedOn: "2026-10-14", fileName: "FUEL.jpg" },
        { bookedOn: "2026-10-15", fileName: "../../toll" },
      ]),
    ).toEqual([
      "2026-10-14 fuel.jpg",
      "2026-10-14 fuel (2).jpg",
      "2026-10-14 FUEL (3).jpg",
      "2026-10-15 .._.._toll",
    ]);
  });
});
