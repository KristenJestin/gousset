import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { importUpload } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { count, eq, lte, sql } from "drizzle-orm";
import { Effect, Option } from "effect";

import { EmptyFile, FileTooLarge, FileUploadPartRefused, TooManyParts } from "./errors";
import { isId } from "./rows";
import { MAX_FILE_BYTES } from "./summary";
import type { ImportFormat } from "./summary";

// File uploads (#129): a statement an agent sends from its own shell to an address the MCP door
// gives it, rather than its bytes inside a tool call. The door makes one (`imports`
// `create_upload`), the upload route fills it, in one part or several, and the door imports it
// once (`imports` `upload`), as the import screen imports a file dropped.

/** How long a file upload waits for its file and its import before it expires. */
export const UPLOAD_MINUTES = 15;

/** How many file uploads a user may have waiting at once. */
export const MAX_PENDING_UPLOADS = 5;

/** How many parts a file may be sent in, for a proxy that caps a request's size. */
export const MAX_UPLOAD_PARTS = 20;

/** The random bytes of an upload address's secret: 256 bits. */
const SECRET_BYTES = 32;

/** What an agent declares of a file before it sends it, and the grant it calls with. */
export type FileUploadRequest = {
  /** The MCP grant (the user's consent to the client) the call came with. */
  readonly grantId: string;
  readonly fileName: string;
  /** In bytes: the parts must add up to it exactly. */
  readonly size: number;
  readonly parts: number;
  readonly accountId: string | null;
  readonly format: ImportFormat | null;
};

/** A file upload made: `token` ends its address, and is given once, never kept. */
export type CreatedUpload = {
  readonly id: string;
  readonly token: string;
  readonly fileName: string;
  readonly size: number;
  readonly parts: number;
  /** ISO 8601. */
  readonly expiresAt: string;
};

/** `pending` until every part arrived, then `uploaded`; `expired` past its expiry, either way. */
export type FileUploadState = "pending" | "uploaded" | "expired";

/** How far a file upload is. */
export type UploadProgress = {
  readonly size: number;
  readonly parts: number;
  readonly partsReceived: number;
  readonly bytesReceived: number;
};

/** A file upload, as `imports` `status` says it. */
export type FileUploadStatus = UploadProgress & {
  readonly id: string;
  readonly fileName: string;
  readonly state: FileUploadState;
  /** ISO 8601. */
  readonly expiresAt: string;
};

/** A part kept, and how far the file upload is now. */
export type ReceivedPart = UploadProgress & {
  readonly id: string;
  readonly part: number;
  readonly complete: boolean;
};

const encodeOwner = (owner: string) => Buffer.from(owner, "utf8").toString("base64url");

/**
 * The last segment of an upload address: whose it is (a user's transaction is opened for them
 * before anything is read), the file upload's id, and its secret.
 */
export function uploadToken(owner: string, id: string, secret: string): string {
  return `${encodeOwner(owner)}.${id}.${secret}`;
}

const OWNER = /^[\w-]{1,400}$/;
const SECRET = /^[\w-]{43}$/;

/** An upload address's token, read back; none for anything not written by `uploadToken`. */
export function parseUploadToken(
  token: string,
): Option.Option<{ readonly owner: string; readonly id: string; readonly secret: string }> {
  const [encoded = "", id = "", secret = "", ...rest] = token.split(".");

  if (rest.length > 0 || !OWNER.test(encoded) || !isId(id) || !SECRET.test(secret)) {
    return Option.none();
  }

  const owner = Buffer.from(encoded, "base64url").toString("utf8");

  // base64url decodes leniently: only the one spelling `uploadToken` writes names its owner.
  return owner !== "" && encodeOwner(owner) === encoded
    ? Option.some({ owner, id, secret })
    : Option.none();
}

/** A new secret: 256 random bits, in base64url. */
export const newSecret = () => randomBytes(SECRET_BYTES).toString("base64url");

/** What is kept of a secret: its SHA-256, in hexadecimal. */
export const secretHash = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** Whether `secret` is the one whose hash was kept, compared in constant time. */
export function isSecretOf(secret: string, kept: string): boolean {
  const given = Buffer.from(secretHash(secret), "hex");
  const stored = Buffer.from(kept, "hex");

  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** Why a file upload cannot be declared so, or `null`: the import's own limits, per file. */
export function requestRefusal(
  size: number,
  parts: number,
): EmptyFile | FileTooLarge | TooManyParts | null {
  if (size <= 0) {
    return new EmptyFile();
  }

  if (size > MAX_FILE_BYTES) {
    return new FileTooLarge({ bytes: size, limit: MAX_FILE_BYTES });
  }

  // Every part holds one byte at least.
  const limit = Math.min(MAX_UPLOAD_PARTS, size);

  return parts < 1 || parts > limit ? new TooManyParts({ limit }) : null;
}

export function uploadState(progress: UploadProgress, expiresAt: Date, now: Date): FileUploadState {
  if (expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }

  return progress.partsReceived === progress.parts ? "uploaded" : "pending";
}

/**
 * Why a part of `bytes` bytes, numbered `part` (none given: the only one), is refused, or `null`.
 * Parts come in order, each once; each holds one byte at least, and the last one ends exactly on
 * the declared size: a file larger or smaller than declared is never kept.
 */
export function partRefusal(
  progress: UploadProgress,
  part: number | null,
  bytes: number,
): FileUploadPartRefused | null {
  const expectedPart = progress.partsReceived + 1;
  const bytesLeft = progress.size - progress.bytesReceived;

  const refuse = (reason: FileUploadPartRefused["reason"]) =>
    new FileUploadPartRefused({ reason, expectedPart, parts: progress.parts, bytesLeft });

  if (progress.partsReceived >= progress.parts) {
    return refuse("complete");
  }

  const number = part ?? (progress.parts === 1 ? 1 : null);

  if (number === null) {
    return refuse("part_needed");
  }

  if (number !== expectedPart) {
    return refuse("out_of_order");
  }

  if (bytes === 0) {
    return refuse("empty");
  }

  const partsAfter = progress.parts - number;
  const fits = partsAfter === 0 ? bytes === bytesLeft : bytes <= bytesLeft - partsAfter;

  return fits ? null : refuse("size");
}

/** A file upload's row, without its content. */
export const uploadColumns = {
  id: importUpload.id,
  grantId: importUpload.grantId,
  secretSha256: importUpload.secretSha256,
  fileName: importUpload.fileName,
  size: importUpload.size,
  parts: importUpload.parts,
  partsReceived: importUpload.partsReceived,
  bytesReceived: sql<number>`octet_length(${importUpload.content})::integer`,
  accountId: importUpload.accountId,
  format: importUpload.format,
  expiresAt: importUpload.expiresAt,
};

/** The user's file upload with this id, locked until the transaction ends, without its content. */
export async function lockedUpload(transaction: UserTransaction, id: string) {
  if (!isId(id)) {
    return undefined;
  }

  const [row] = await transaction
    .select(uploadColumns)
    .from(importUpload)
    .where(eq(importUpload.id, id))
    .for("update");

  return row;
}

/** Deletes the user's file uploads past their expiry; how many there were. */
export async function deleteExpired(transaction: UserTransaction, now: Date): Promise<number> {
  const deleted = await transaction
    .delete(importUpload)
    .where(lte(importUpload.expiresAt, now))
    .returning({ id: importUpload.id });

  return deleted.length;
}

/**
 * Deletes `owner`'s file uploads past their expiry, with what they received: the sweep job runs it
 * for every user. How many there were.
 */
export const sweepUploads = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, (transaction) =>
      deleteExpired(transaction, new Date()),
    );
  });

/**
 * Makes a file upload for `owner`, once their expired ones are gone; `null` when they have
 * `MAX_PENDING_UPLOADS` waiting already. Two calls of one user wait for each other, so that the
 * count holds.
 */
export async function insertUpload(
  transaction: UserTransaction,
  owner: string,
  request: FileUploadRequest,
  now: Date,
): Promise<CreatedUpload | null> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`gousset.import_upload:${owner}`}, 0))`,
  );
  await deleteExpired(transaction, now);

  const [pending] = await transaction.select({ uploads: count() }).from(importUpload);

  if ((pending?.uploads ?? 0) >= MAX_PENDING_UPLOADS) {
    return null;
  }

  const secret = newSecret();
  const expiresAt = new Date(now.getTime() + UPLOAD_MINUTES * 60_000);

  const [row] = await transaction
    .insert(importUpload)
    .values({
      userId: owner,
      grantId: request.grantId,
      secretSha256: secretHash(secret),
      fileName: request.fileName,
      size: request.size,
      parts: request.parts,
      accountId: request.accountId,
      format: request.format,
      createdAt: now,
      expiresAt,
    })
    .returning({ id: importUpload.id });

  if (row === undefined) {
    throw new Error("The insert returned no row.");
  }

  return {
    id: row.id,
    token: uploadToken(owner, row.id, secret),
    fileName: request.fileName,
    size: request.size,
    parts: request.parts,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Appends a part to a file upload whose row `lockedUpload` holds. */
export async function appendPart(
  transaction: UserTransaction,
  id: string,
  content: Uint8Array,
): Promise<void> {
  await transaction
    .update(importUpload)
    .set({
      content: sql`${importUpload.content} || ${Buffer.from(content)}::bytea`,
      partsReceived: sql`${importUpload.partsReceived} + 1`,
    })
    .where(eq(importUpload.id, id));
}
