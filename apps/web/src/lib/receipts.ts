import { RECEIPT_TYPES } from "@gousset/core/attachments";
import type { ReceiptLimits } from "@gousset/core/attachments";
import { Option, Schema } from "effect";

// A line's receipts (#217) as the routes take and give them (`routes/api/lines/$lineId/receipts.ts`,
// `routes/api/receipts/$receiptId.ts`, `routes/api/subjects/$subjectId/receipts.ts`): the upload's
// answer, its refusals' codes, and the addresses, for the pages to call.

/** Where a line's receipt is uploaded: the body is the file's bytes, `name` its name. */
export const receiptUploadPath = (lineId: string, fileName: string) =>
  `/api/lines/${encodeURIComponent(lineId)}/receipts?${new URLSearchParams({ name: fileName }).toString()}`;

/** Where a receipt is downloaded. */
export const receiptPath = (receiptId: string) => `/api/receipts/${encodeURIComponent(receiptId)}`;

/** Where a subject's receipts are downloaded, in one zip. */
export const subjectReceiptsPath = (subjectId: string) =>
  `/api/subjects/${encodeURIComponent(subjectId)}/receipts`;

/**
 * Why a receipt's route refused, as a code the page translates (`i18n/receipts.ts`):
 * `RECEIPT_TOO_LARGE` comes with the file's size when known and the limit, both in bytes;
 * `RECEIPT_TYPE` with the kinds the installation takes.
 */
export type ReceiptRefusalCode =
  | "SIGN_IN_REQUIRED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "UPLOAD_FAILED"
  | "LINE_NOT_FOUND"
  | "SUBJECT_NOT_FOUND"
  | "RECEIPT_NOT_FOUND"
  | "RECEIPT_EMPTY"
  | "RECEIPT_TOO_LARGE"
  | "RECEIPT_TYPE"
  | "RECEIPT_UNAVAILABLE";

const ReceiptType = Schema.Literals(RECEIPT_TYPES);

/** A refusal, as the routes answer it in JSON. */
export const ReceiptRefusal = Schema.Struct({
  refused: Schema.Literals([
    "SIGN_IN_REQUIRED",
    "PASSWORD_CHANGE_REQUIRED",
    "UPLOAD_FAILED",
    "LINE_NOT_FOUND",
    "SUBJECT_NOT_FOUND",
    "RECEIPT_NOT_FOUND",
    "RECEIPT_EMPTY",
    "RECEIPT_TOO_LARGE",
    "RECEIPT_TYPE",
    "RECEIPT_UNAVAILABLE",
  ]),
  bytes: Schema.optional(Schema.NullOr(Schema.Number)),
  limit: Schema.optional(Schema.Number),
  allowed: Schema.optional(Schema.Array(ReceiptType)),
});

export type ReceiptRefusal = typeof ReceiptRefusal.Type;

/** A receipt kept, as the upload answers it. */
export const UploadedReceipt = Schema.Struct({
  receipt: Schema.Struct({
    id: Schema.String,
    lineId: Schema.String,
    fileName: Schema.String,
    mediaType: Schema.String,
    size: Schema.Number,
    createdAt: Schema.String,
  }),
});

export const ReceiptUploadAnswer = Schema.Union([UploadedReceipt, ReceiptRefusal]);

export type ReceiptUploadAnswer = typeof ReceiptUploadAnswer.Type;

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(ReceiptUploadAnswer));

/**
 * Attaches `file` to the line `lineId`. A file over the installation's limit is refused here, before
 * a byte is sent; the server refuses it again, and reads its bytes for its kind.
 */
export async function uploadReceipt(
  file: File,
  lineId: string,
  limits: ReceiptLimits,
): Promise<ReceiptUploadAnswer> {
  if (file.size > limits.maxBytes) {
    return { refused: "RECEIPT_TOO_LARGE", bytes: file.size, limit: limits.maxBytes };
  }

  try {
    const response = await fetch(receiptUploadPath(lineId, file.name), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });

    return Option.getOrElse(decodeAnswer(await response.text()), () => ({
      refused: "UPLOAD_FAILED" as const,
    }));
  } catch {
    return { refused: "UPLOAD_FAILED" };
  }
}
