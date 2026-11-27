import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { Context, Effect, Layer, Option, Schema } from "effect";

import { ReceiptStorageFailed, ReceiptTooLarge } from "./errors";
import { SNIFF_BYTES } from "./media";

// Where receipts' files are kept (#217): on disk, not in Postgres, in the directory the
// installation names (`RECEIPTS_DIRECTORY`), which its Docker setup mounts as a volume and its
// owner backs up beside the database's dump (docs/releases.md). One folder per user, named after
// the user's id in base64url, so that no id ever makes a path; each file named by a uuid the app
// draws (`line_attachment.stored_name`), never by the user's own name. Tests give it a directory
// of their own (`receiptStorageLayer`).

/** A file written: its size, and its first bytes, which its type is read from. */
export type StoredFile = { readonly bytes: number; readonly head: Uint8Array };

/** A file found in a user's folder: its name there, and when it was last written. */
export type FileOnDisk = { readonly name: string; readonly modifiedAt: Date };

/** The receipts' directory: every call names the user whose folder it reads or writes. */
export class ReceiptStorage extends Context.Service<
  ReceiptStorage,
  {
    /**
     * Writes `body` as `owner`'s file `name`, atomically: into a file of its own first, renamed to
     * `name` once whole and on disk, so that a crash never leaves half a receipt under its name.
     * Past `limit` bytes it stops reading, keeps nothing, and fails with `ReceiptTooLarge`.
     */
    readonly write: (
      owner: string,
      name: string,
      body: ReadableStream<Uint8Array>,
      limit: number,
    ) => Effect.Effect<StoredFile, ReceiptTooLarge | ReceiptStorageFailed>;
    /** `owner`'s file `name`, whole. */
    readonly read: (
      owner: string,
      name: string,
    ) => Effect.Effect<Uint8Array<ArrayBuffer>, ReceiptStorageFailed>;
    /** `owner`'s file `name`, as a stream, once it is known to be there. */
    readonly open: (
      owner: string,
      name: string,
    ) => Effect.Effect<ReadableStream<Uint8Array>, ReceiptStorageFailed>;
    /** Deletes `owner`'s file `name`; one already gone is no failure. */
    readonly remove: (owner: string, name: string) => Effect.Effect<void, ReceiptStorageFailed>;
    /** Every file of `owner`'s folder, those being written included. */
    readonly list: (
      owner: string,
    ) => Effect.Effect<ReadonlyArray<FileOnDisk>, ReceiptStorageFailed>;
    /** The users who have a folder. */
    readonly owners: () => Effect.Effect<ReadonlyArray<string>, ReceiptStorageFailed>;
    /** Removes `owner`'s folder if it is empty; one that holds a file stays. */
    readonly removeFolder: (owner: string) => Effect.Effect<void, ReceiptStorageFailed>;
  }
>()("@gousset/core/ReceiptStorage") {}

/** A file's name in a user's folder: a uuid, as `line_attachment.stored_name` checks it. */
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A file being written: a dot, the name it will take, the moment it was begun. */
const PARTIAL_NAME = /^\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.part$/;

const FOLDER = /^[\w-]{1,600}$/;

export const isStoredName = (name: string) => STORED_NAME.test(name);

/** A new file's name: drawn at random, so that it says nothing of the user nor of the file. */
export const newStoredName = () => randomUUID();

const folderOf = (owner: string) => Buffer.from(owner, "utf8").toString("base64url");

/** The user a folder's name is, if it is one `folderOf` wrote. */
function ownerOfFolder(folder: string): Option.Option<string> {
  if (!FOLDER.test(folder)) {
    return Option.none();
  }

  const owner = Buffer.from(folder, "base64url").toString("utf8");

  return owner !== "" && folderOf(owner) === folder ? Option.some(owner) : Option.none();
}

/** A path that is inside `directory`, or none: never the directory itself, never above it. */
function inside(directory: string, ...parts: ReadonlyArray<string>): Option.Option<string> {
  const path = resolve(directory, ...parts);
  const within = relative(directory, path);

  return within !== "" && !within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within)
    ? Option.some(path)
    : Option.none();
}

const systemError = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

/** A folder or a file that is not there. */
const isMissing = Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }));

/** A folder that still holds a file. */
const isNotEmpty = Schema.is(Schema.Struct({ code: Schema.Literal("ENOTEMPTY") }));

/** The entries of a folder; none when it does not exist yet. */
async function entriesOf(folder: string): Promise<ReadonlyArray<string>> {
  try {
    return await readdir(folder);
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }
}

/** A stream of a file opened already, closed once read or cancelled. */
function streamOf(file: FileHandle): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = new Uint8Array(64 * 1024);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);

      if (bytesRead === 0) {
        await file.close();
        controller.close();

        return;
      }

      controller.enqueue(chunk.subarray(0, bytesRead));
    },
    async cancel() {
      await file.close();
    },
  });
}

/** A refusal of a name or an owner that would make no path inside the directory. */
const refusedPath = () => new ReceiptStorageFailed({ code: "INVALID_PATH" });

/** Runs `work` on the file system; a failure as its code alone: its message would name the path. */
const attempt = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (error) =>
      new ReceiptStorageFailed({
        code: Option.match(systemError(error), {
          onNone: () => "UNKNOWN",
          onSome: (found) => found.code,
        }),
      }),
  });

/** The result of streaming a body to a file: written, or cut past its limit. */
type Streamed = { readonly written: StoredFile } | { readonly tooLarge: true };

async function streamTo(
  path: string,
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Streamed> {
  const file = await open(path, "wx", 0o600);
  const reader = body.getReader();
  const head = new Uint8Array(SNIFF_BYTES);
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (bytes + value.byteLength > limit) {
        await reader.cancel();

        return { tooLarge: true };
      }

      if (bytes < SNIFF_BYTES) {
        head.set(value.subarray(0, SNIFF_BYTES - bytes), bytes);
      }

      bytes += value.byteLength;
      await file.write(value);
    }

    await file.sync();

    return { written: { bytes, head: head.slice(0, Math.min(bytes, SNIFF_BYTES)) } };
  } finally {
    await file.close();
  }
}

/** `ReceiptStorage` on the folder `directory` of this machine, made when first written to. */
export function receiptStorageLayer(directory: string): Layer.Layer<ReceiptStorage> {
  const root = resolve(directory);

  // A file's name is one the app made, or none: never a name a user gave, nor `..`.
  const pathOf = (owner: string, name: string) =>
    isStoredName(name) || PARTIAL_NAME.test(name)
      ? inside(root, folderOf(owner), name)
      : Option.none();

  const withPath = <A, E>(
    owner: string,
    name: string,
    work: (path: string) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | ReceiptStorageFailed> =>
    Option.match(pathOf(owner, name), {
      onNone: () => Effect.fail(refusedPath()),
      onSome: work,
    });

  return Layer.succeed(ReceiptStorage, {
    write: (owner, name, body, limit) =>
      withPath(owner, isStoredName(name) ? name : "", (path) =>
        Effect.gen(function* () {
          const folder = resolve(path, "..");
          const partial = join(folder, `.${name}.${randomUUID()}.part`);

          yield* attempt(() => mkdir(folder, { recursive: true, mode: 0o700 }));

          const streamed = yield* attempt(() => streamTo(partial, body, limit)).pipe(
            Effect.tapError(() => attempt(() => rm(partial, { force: true })).pipe(Effect.ignore)),
          );

          if ("tooLarge" in streamed) {
            yield* attempt(() => rm(partial, { force: true }));

            return yield* Effect.fail(new ReceiptTooLarge({ bytes: null, limit }));
          }

          yield* attempt(() => rename(partial, path));

          return streamed.written;
        }),
      ),

    read: (owner, name) =>
      withPath(owner, name, (path) => attempt(() => readFile(path))).pipe(
        Effect.map((content) => new Uint8Array(content)),
      ),

    open: (owner, name) =>
      withPath(owner, name, (path) =>
        // Opened before the stream is given, so that a missing file fails here, before a
        // response has started.
        attempt(async () => streamOf(await open(path, "r"))),
      ),

    remove: (owner, name) =>
      withPath(owner, name, (path) => attempt(() => rm(path, { force: true }))),

    list: (owner) =>
      Option.match(inside(root, folderOf(owner)), {
        onNone: () => Effect.fail(refusedPath()),
        onSome: (folder) =>
          attempt(async () => {
            const names = await entriesOf(folder);
            const files: Array<FileOnDisk> = [];

            for (const name of names) {
              if (!isStoredName(name) && !PARTIAL_NAME.test(name)) {
                continue;
              }

              try {
                const found = await stat(join(folder, name));

                if (found.isFile()) {
                  files.push({ name, modifiedAt: found.mtime });
                }
              } catch (error) {
                // Renamed or deleted since the folder was read.
                if (!isMissing(error)) {
                  throw error;
                }
              }
            }

            return files;
          }),
      }),

    owners: () =>
      attempt(async () => {
        const folders = await entriesOf(root);

        return folders.flatMap((folder) => Option.toArray(ownerOfFolder(folder)));
      }),

    removeFolder: (owner) =>
      Option.match(inside(root, folderOf(owner)), {
        onNone: () => Effect.fail(refusedPath()),
        onSome: (folder) =>
          attempt(async () => {
            try {
              await rmdir(folder);
            } catch (error) {
              // Gone already, or holding a file: either way, nothing to do.
              if (!isMissing(error) && !isNotEmpty(error)) {
                throw error;
              }
            }
          }),
      }),
  });
}

/** Whether `name`, found in a user's folder, is a file still being written. */
export const isPartialName = (name: string) => PARTIAL_NAME.test(name);
