import { Schema } from "effect";

import { RECEIPT_TYPES } from "./media";

// Why a receipt is refused (#217). Each names what a page and the MCP door need to say what to do,
// and nothing of the file: no name, no content.

/**
 * The file is larger than the installation takes: `bytes` its size when known (a body that kept
 * coming past the limit is cut there, its size never read), `limit` the limit, both in bytes.
 */
export class ReceiptTooLarge extends Schema.TaggedError<ReceiptTooLarge>()("ReceiptTooLarge", {
  bytes: Schema.NullOr(Schema.Number),
  limit: Schema.Number,
}) {}

/** The file's first bytes are none of the kinds the installation takes, `allowed`. */
export class ReceiptTypeRefused extends Schema.TaggedError<ReceiptTypeRefused>()(
  "ReceiptTypeRefused",
  { allowed: Schema.Array(Schema.Literals(RECEIPT_TYPES)) },
) {}

/** The file is empty. */
export class ReceiptEmpty extends Schema.TaggedError<ReceiptEmpty>()("ReceiptEmpty", {}) {}

/** No receipt of the user's has this id. */
export class ReceiptNotFound extends Schema.TaggedError<ReceiptNotFound>()("ReceiptNotFound", {
  receiptId: Schema.String,
}) {}

/**
 * The receipts' directory could not be written or read (a full disk, a volume not mounted, a file
 * gone from it): what the system said, as its code alone (`ENOSPC`, `ENOENT`), never a path.
 */
export class ReceiptStorageFailed extends Schema.TaggedError<ReceiptStorageFailed>()(
  "ReceiptStorageFailed",
  { code: Schema.String },
) {}
