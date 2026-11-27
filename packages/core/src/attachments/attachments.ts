import { lineAttachment, statementLine, subject } from "@gousset/db/schema/ledger";
import { QueryFailed, UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { asc, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { LineNotFound } from "../errors";
import { safeFileName } from "../export/archive";
import { isId } from "../imports/rows";
import { SubjectNotFound } from "../subjects/errors";
import { zipStream } from "../zip-stream";
import type { ZipEntry } from "../zip-stream";
import { ReceiptEmpty, ReceiptNotFound, ReceiptTooLarge, ReceiptTypeRefused } from "./errors";
import type { ReceiptStorageFailed } from "./errors";
import { MEDIA_TYPES, sniffReceiptType } from "./media";
import type { ReceiptLimits, ReceiptMediaType } from "./media";
import { ReceiptStorage, isPartialName, isStoredName, newStoredName } from "./storage";

// A line's receipts (#217): a photo or a PDF attached to any line, its file on disk
// (`ReceiptStorage`), its row in `line_attachment`, each user's apart (`UserData`). The pages and
// the MCP door both call these.

/** A receipt, as a line's detail lists it. */
export type Receipt = {
  readonly id: string;
  readonly lineId: string;
  /** As the user named it: shown, never a path. */
  readonly fileName: string;
  readonly mediaType: ReceiptMediaType;
  /** In bytes. */
  readonly size: number;
  /** ISO 8601. */
  readonly createdAt: string;
};

/** A receipt of a subject's, with the line it is attached to. */
export type SubjectReceipt = Receipt & {
  /** The line's booking day, `YYYY-MM-DD`. */
  readonly bookedOn: string;
  /** The line's label, as the bank wrote it. */
  readonly label: string;
};

/** A file being received: its name, its size when the request says it, and its bytes. */
export type ReceiptUpload = {
  readonly fileName: string;
  /** The size the request declared (`Content-Length`), or `null` when it declared none. */
  readonly declaredBytes: number | null;
  readonly body: ReadableStream<Uint8Array>;
};

/** A receipt to download: what it is, and its bytes as they are read. */
export type ReceiptDownload = {
  readonly receipt: Receipt;
  readonly content: ReadableStream<Uint8Array>;
};

/** A subject's receipts in one zip, made as it is read. */
export type ReceiptsZip = {
  readonly fileName: string;
  /** How many receipts it holds. */
  readonly receipts: number;
  readonly content: ReadableStream<Uint8Array>;
};

/** A name kept within what file systems take, as shown, never a path. */
const MAX_FILE_NAME = 255;

/** How old a file no row names must be before the sweep deletes it: one being attached has none yet. */
export const SWEEP_AFTER_MINUTES = 60;

const MediaType = Schema.Literals(Object.values(MEDIA_TYPES));

const receiptColumns = {
  id: lineAttachment.id,
  lineId: lineAttachment.lineId,
  fileName: lineAttachment.fileName,
  mediaType: lineAttachment.mediaType,
  size: lineAttachment.size,
  storedName: lineAttachment.storedName,
  createdAt: lineAttachment.createdAt,
};

type ReceiptRow = {
  readonly id: string;
  readonly lineId: string;
  readonly fileName: string;
  readonly mediaType: ReceiptMediaType;
  readonly size: number;
  readonly storedName: string;
  readonly createdAt: Date;
};

const receiptOf = (row: ReceiptRow): Receipt => ({
  id: row.id,
  lineId: row.lineId,
  fileName: row.fileName,
  mediaType: row.mediaType,
  size: row.size,
  createdAt: row.createdAt.toISOString(),
});

/** The name a user gave, without what no file system shows: control characters, outer spaces. */
function displayName(name: string): string {
  const shown = name
    .replaceAll(/\p{Cc}/gu, "")
    .trim()
    .slice(0, MAX_FILE_NAME);

  return shown === "" ? "receipt" : shown;
}

async function lineExists(transaction: UserTransaction, lineId: string): Promise<boolean> {
  if (!isId(lineId)) {
    return false;
  }

  const [found] = await transaction
    .select({ id: statementLine.id })
    .from(statementLine)
    .where(eq(statementLine.id, lineId));

  return found !== undefined;
}

async function receiptRow(transaction: UserTransaction, id: string) {
  if (!isId(id)) {
    return undefined;
  }

  const [row] = await transaction
    .select(receiptColumns)
    .from(lineAttachment)
    .where(eq(lineAttachment.id, id));

  return row;
}

/** The SQLSTATE of a key that points to no row: the line was deleted meanwhile. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Attaches the file `upload` brings to `owner`'s line `lineId`, as a receipt; any line takes one.
 * Refused, keeping nothing: a line none of the user's (`LineNotFound`), an empty file
 * (`ReceiptEmpty`), one over `limits.maxBytes` (`ReceiptTooLarge`, read no further than the limit),
 * one whose first bytes are none of `limits.types` (`ReceiptTypeRefused`), whatever its name says.
 */
export const attachReceipt = (
  owner: string,
  lineId: string,
  upload: ReceiptUpload,
  limits: ReceiptLimits,
) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const storage = yield* ReceiptStorage;

    if (!(yield* userData.transaction(owner, (each) => lineExists(each, lineId)))) {
      return yield* Effect.fail(new LineNotFound({ lineId }));
    }

    if (upload.declaredBytes !== null && upload.declaredBytes > limits.maxBytes) {
      return yield* Effect.fail(
        new ReceiptTooLarge({ bytes: upload.declaredBytes, limit: limits.maxBytes }),
      );
    }

    const storedName = newStoredName();

    const written = yield* storage
      .write(owner, storedName, upload.body, limits.maxBytes)
      .pipe(
        Effect.catchTag("ReceiptTooLarge", (refused) =>
          Effect.fail(new ReceiptTooLarge({ bytes: upload.declaredBytes, limit: refused.limit })),
        ),
      );

    const forget = storage.remove(owner, storedName).pipe(Effect.ignore);
    const type = sniffReceiptType(written.head);

    if (written.bytes === 0) {
      yield* forget;

      return yield* Effect.fail(new ReceiptEmpty());
    }

    if (type === undefined || !limits.types.includes(type)) {
      yield* forget;

      return yield* Effect.fail(new ReceiptTypeRefused({ allowed: limits.types }));
    }

    const inserted = yield* userData
      .transaction(owner, (each) =>
        each
          .insert(lineAttachment)
          .values({
            userId: owner,
            lineId,
            fileName: displayName(upload.fileName),
            mediaType: MEDIA_TYPES[type],
            size: written.bytes,
            storedName,
          })
          .returning(receiptColumns),
      )
      .pipe(
        Effect.tapError(() => forget),
        Effect.catchTag(
          "QueryFailed",
          (failure): Effect.Effect<never, LineNotFound | QueryFailed> =>
            failure.code === FOREIGN_KEY_VIOLATION
              ? Effect.fail(new LineNotFound({ lineId }))
              : Effect.fail(failure),
        ),
      );

    const [row] = inserted;

    if (row === undefined) {
      yield* forget;

      return yield* Effect.fail(new QueryFailed({ code: "UNKNOWN" }));
    }

    return receiptOf(row);
  });

/** The receipts of the line `lineId`, the first attached first (a line's detail, `../lines`). */
export async function receiptsOfLineIn(
  transaction: UserTransaction,
  lineId: string,
): Promise<ReadonlyArray<Receipt>> {
  const rows = await transaction
    .select(receiptColumns)
    .from(lineAttachment)
    .where(eq(lineAttachment.lineId, lineId))
    .orderBy(asc(lineAttachment.id));

  return rows.map(receiptOf);
}

/** The receipts of `owner`'s line `lineId`, the first attached first. */
export const lineReceipts = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const receipts = yield* userData.transaction(owner, async (each) =>
      (await lineExists(each, lineId)) ? receiptsOfLineIn(each, lineId) : undefined,
    );

    if (receipts === undefined) {
      return yield* Effect.fail(new LineNotFound({ lineId }));
    }

    return receipts;
  });

const SubjectReceiptRows = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      lineId: Schema.String,
      fileName: Schema.String,
      mediaType: MediaType,
      size: Schema.Number,
      storedName: Schema.String,
      createdAt: Schema.String,
      bookedOn: Schema.String,
      label: Schema.String,
    }),
  ),
});

const decodeSubjectReceipts = Schema.decodeUnknownSync(SubjectReceiptRows);

/**
 * The receipts of every line `subjectId`'s expenses come from, its descendants' included (a
 * subject counts its children's expenses, docs/data-model.md, v0.5): their payments and their
 * refunds, and the lines that pay it back (an expense report's statement belongs there). Each
 * once, by its line's day, then as attached.
 */
async function subjectReceiptRows(transaction: UserTransaction, subjectId: string) {
  const result = await transaction.execute(sql`
    with recursive tree (id) as (
      select id from subject where id = ${subjectId}
      union
      select child.id from subject child join tree on child.parent_id = tree.id
    )
    select a.id::text as "id", a.line_id::text as "lineId", a.file_name as "fileName",
      a.media_type::text as "mediaType", a.size::float8 as "size", a.stored_name as "storedName",
      to_json(a.created_at) #>> '{}' as "createdAt", l.booked_on::text as "bookedOn",
      l.label as "label"
    from line_attachment a
    join statement_line l on l.id = a.line_id
    where a.line_id in (
      select part.line_id from entry_part part
      join entry_subject attached on attached.entry_id = part.entry_id
      where attached.subject_id in (select id from tree)
      union
      select payback.line_id from subject_payback payback
      where payback.subject_id in (select id from tree)
    )
    order by l.booked_on, a.id`);

  return decodeSubjectReceipts(result).rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
  }));
}

/** The subject's name, if `owner` has a subject `subjectId`. */
async function subjectName(transaction: UserTransaction, subjectId: string) {
  if (!isId(subjectId)) {
    return undefined;
  }

  const [found] = await transaction
    .select({ name: subject.name })
    .from(subject)
    .where(eq(subject.id, subjectId));

  return found?.name;
}

const readSubjectReceipts = (owner: string, subjectId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const read = yield* userData.snapshot(owner, async (each) => {
      const name = await subjectName(each, subjectId);

      return name === undefined
        ? undefined
        : { name, rows: await subjectReceiptRows(each, subjectId) };
    });

    if (read === undefined) {
      return yield* Effect.fail(new SubjectNotFound({ subjectId }));
    }

    return read;
  });

/**
 * The receipts of `owner`'s subject `subjectId`: those of every line its expenses come from, and
 * of its payback lines.
 */
export const subjectReceipts = (owner: string, subjectId: string) =>
  readSubjectReceipts(owner, subjectId).pipe(
    Effect.map(({ rows }): ReadonlyArray<SubjectReceipt> =>
      rows.map((row) => ({ ...receiptOf(row), bookedOn: row.bookedOn, label: row.label })),
    ),
  );

/** Deletes `owner`'s receipt `receiptId`, its file with it. */
export const deleteReceipt = (owner: string, receiptId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const storage = yield* ReceiptStorage;

    const [deleted] = isId(receiptId)
      ? yield* userData.transaction(owner, (each) =>
          each
            .delete(lineAttachment)
            .where(eq(lineAttachment.id, receiptId))
            .returning({ storedName: lineAttachment.storedName }),
        )
      : [];

    if (deleted === undefined) {
      return yield* Effect.fail(new ReceiptNotFound({ receiptId }));
    }

    // The row is gone: a file that stays (a disk that refused) is the sweep's.
    yield* storage.remove(owner, deleted.storedName).pipe(Effect.ignore);
  });

const findReceipt = (owner: string, receiptId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const row = yield* userData.transaction(owner, (each) => receiptRow(each, receiptId));

    if (row === undefined) {
      return yield* Effect.fail(new ReceiptNotFound({ receiptId }));
    }

    return row;
  });

/** A file the row names but the disk does not hold: lost, as the sweep never deletes a named one. */
const missingFile =
  (receiptId: string) =>
  (failure: ReceiptStorageFailed): Effect.Effect<never, ReceiptNotFound | ReceiptStorageFailed> =>
    failure.code === "ENOENT"
      ? Effect.fail(new ReceiptNotFound({ receiptId }))
      : Effect.fail(failure);

/** `owner`'s receipt `receiptId`, with its bytes as a stream, for a download. */
export const openReceipt = (owner: string, receiptId: string) =>
  Effect.gen(function* () {
    const storage = yield* ReceiptStorage;
    const row = yield* findReceipt(owner, receiptId);

    const content = yield* storage
      .open(owner, row.storedName)
      .pipe(Effect.catchTag("ReceiptStorageFailed", missingFile(receiptId)));

    return { receipt: receiptOf(row), content } satisfies ReceiptDownload;
  });

/** `owner`'s receipt `receiptId`, with its bytes whole. */
export const readReceipt = (owner: string, receiptId: string) =>
  Effect.gen(function* () {
    const storage = yield* ReceiptStorage;
    const row = yield* findReceipt(owner, receiptId);

    const content = yield* storage
      .read(owner, row.storedName)
      .pipe(Effect.catchTag("ReceiptStorageFailed", missingFile(receiptId)));

    return { receipt: receiptOf(row), content };
  });

/** "2026-10-14 fuel.jpg", then "2026-10-14 fuel (2).jpg" for a second of that name. */
export function zipPaths(
  receipts: ReadonlyArray<{ readonly bookedOn: string; readonly fileName: string }>,
): ReadonlyArray<string> {
  const taken = new Set<string>();

  return receipts.map(({ bookedOn, fileName }) => {
    const name = safeFileName(`${bookedOn} ${fileName}`);
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let path = name;

    for (let copy = 2; taken.has(path.toLowerCase()); copy += 1) {
      path = `${stem} (${copy})${extension}`;
    }

    taken.add(path.toLowerCase());

    return path;
  });
}

/**
 * Every receipt of `owner`'s subject `subjectId` in one zip, each named by its line's day and its
 * own name, made as it is downloaded. A receipt whose file is no longer on disk is left out.
 */
export const subjectReceiptsZip = (owner: string, subjectId: string, now: Date) =>
  Effect.gen(function* () {
    const storage = yield* ReceiptStorage;
    const { name, rows } = yield* readSubjectReceipts(owner, subjectId);
    const onDisk = new Set((yield* storage.list(owner)).map((file) => file.name));
    const kept = rows.filter((row) => onDisk.has(row.storedName));
    const paths = zipPaths(kept);

    const entries = kept.map((row, index): ZipEntry => ({
      path: paths[index] ?? row.storedName,
      open: () => Effect.runPromise(storage.open(owner, row.storedName)),
    }));

    return {
      fileName: safeFileName(`${name} - receipts.zip`),
      receipts: kept.length,
      content: zipStream(entries, now),
    } satisfies ReceiptsZip;
  });

/**
 * Deletes the files no receipt names any more, `SWEEP_AFTER_MINUTES` old or more, in every user's
 * folder: those of lines deleted (an undone import, a deleted account), of users deleted, and of
 * attachments that failed half way. A file being attached has no row yet, and is younger. How many
 * files it deleted.
 */
export const sweepReceipts = (now: Date) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const storage = yield* ReceiptStorage;
    const before = now.getTime() - SWEEP_AFTER_MINUTES * 60_000;
    let deleted = 0;

    for (const owner of yield* storage.owners()) {
      const named = new Set(
        (yield* userData.transaction(owner, (each) =>
          each.select({ storedName: lineAttachment.storedName }).from(lineAttachment),
        )).map((row) => row.storedName),
      );

      const files = yield* storage.list(owner);

      for (const file of files) {
        const orphan =
          isPartialName(file.name) || (isStoredName(file.name) && !named.has(file.name));

        if (orphan && file.modifiedAt.getTime() <= before) {
          yield* storage.remove(owner, file.name);
          deleted += 1;
        }
      }

      yield* storage.removeFolder(owner);
    }

    return deleted;
  });
