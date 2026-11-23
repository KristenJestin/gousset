import { MAX_FILE_BYTES } from "@gousset/core/imports";
import { Option, Schema } from "effect";

/** Where a statement file is uploaded (`routes/api/imports.ts`). */
export const UPLOAD_PATH = "/api/imports";

/** What the upload answers: the import started, or a refusal's code. */
export const UploadAnswer = Schema.Union([
  Schema.Struct({
    importId: Schema.String,
    jobId: Schema.NullOr(Schema.String),
    /** The same file, imported before: nothing is added twice, and the screen says so at once. */
    sameFile: Schema.NullOr(Schema.Struct({ fileName: Schema.String, importedAt: Schema.String })),
  }),
  Schema.Struct({ refused: Schema.String }),
]);

export type UploadAnswer = typeof UploadAnswer.Type;

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(UploadAnswer));

/**
 * Uploads one file and starts its import, for the account chosen when there is one. A file over
 * the limit is refused here, before a byte is sent; the server refuses it too.
 */
export async function uploadStatement(file: File, accountId: string | null): Promise<UploadAnswer> {
  if (file.size > MAX_FILE_BYTES) {
    return { refused: "FILE_TOO_LARGE" };
  }

  const query = new URLSearchParams({ name: file.name });

  if (accountId !== null) {
    query.set("account", accountId);
  }

  try {
    const response = await fetch(`${UPLOAD_PATH}?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });

    // A refusal comes with its code in JSON (413, 422, 503); any other failure (a proxy's page,
    // a crash) says nothing the screen can read.
    const refusal = response.status === 413 || response.status === 422 || response.status === 503;

    if (!response.ok && !refusal) {
      return { refused: "UPLOAD_FAILED" };
    }

    return Option.getOrElse(decodeAnswer(await response.text()), () => ({
      refused: "UPLOAD_FAILED",
    }));
  } catch {
    return { refused: "UPLOAD_FAILED" };
  }
}
