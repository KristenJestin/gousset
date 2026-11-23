import { Imports } from "@gousset/core";
import { MAX_FILE_BYTES } from "@gousset/core/imports";
import { createFileRoute } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";

import type { UploadAnswer } from "../../lib/upload";
import { usableSession } from "../../lib/session.server";
import { runCore } from "../../services";

const NO_STORE = { "Cache-Control": "no-store" };

/** A format the user named, as the database's `import_format` writes it. */
const Format = Schema.Literals(["ofx", "qfx", "qif", "camt053", "mt940", "csv"]);

const formatOf = Schema.decodeUnknownOption(Format);

const json = (body: UploadAnswer, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, "Content-Type": "application/json" },
  });

const refused = (code: string, status: number) => json({ refused: code }, status);

/**
 * The request's body, read until `MAX_FILE_BYTES`: past it, reading stops and `undefined` says
 * the file is too large, before anything is kept or read. A `Content-Length` over the limit is
 * refused before a byte is read.
 */
async function boundedBody(request: Request): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");

  if (declared > MAX_FILE_BYTES || request.body === null) {
    return declared > MAX_FILE_BYTES ? undefined : new Uint8Array();
  }

  const reader = request.body.getReader();
  const parts: Array<Uint8Array> = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > MAX_FILE_BYTES) {
      await reader.cancel();

      return undefined;
    }

    parts.push(value);
  }

  const bytes = new Uint8Array(size);
  let at = 0;

  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }

  return bytes;
}

/**
 * Uploads one statement file for the signed-in user and starts its import: the body is the file's
 * bytes, `name` its name, and `account` and `format` what the user chose, when they did. Answers
 * the import's id and job, or a refusal's code (`SIGN_IN_REQUIRED`, `PASSWORD_CHANGE_REQUIRED`,
 * `FILE_TOO_LARGE`, `EMPTY_FILE`, `UNKNOWN_FORMAT`, `ACCOUNT_NOT_FOUND`, `IMPORT_UNAVAILABLE`).
 */
export const Route = createFileRoute("/api/imports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // A page of another origin (a sibling subdomain, which the session cookie reaches) can
        // send only a simple request without asking first: never this type, which takes a
        // preflight that no CORS answer allows.
        if (request.headers.get("content-type") !== "application/octet-stream") {
          return refused("UPLOAD_FAILED", 415);
        }

        const { session, refusal } = await usableSession(request.headers);

        // A temporary password imports nothing: someone else chose it (#70, #79).
        if (session === undefined) {
          return refused(refusal, refusal === "SIGN_IN_REQUIRED" ? 401 : 403);
        }

        const content = await boundedBody(request);

        if (content === undefined) {
          return refused("FILE_TOO_LARGE", 413);
        }

        const query = new URL(request.url).searchParams;
        const fileName = (query.get("name") ?? "").slice(0, 255) || "statement";
        const account = query.get("account");

        const format = formatOf(query.get("format") ?? undefined);

        const start = Effect.gen(function* () {
          const imports = yield* Imports;

          return yield* imports.start(session.user.id, {
            fileName,
            content,
            format: Option.getOrNull(format),
            accountId: account === null || account === "" ? null : account,
          });
        });

        return runCore(
          start.pipe(
            Effect.map((started) =>
              json({
                importId: started.started.id,
                jobId: started.started.jobId,
                sameFile: started.sameFile,
              }),
            ),
            Effect.catchTags({
              EmptyFile: () => Effect.succeed(refused("EMPTY_FILE", 422)),
              FileTooLarge: () => Effect.succeed(refused("FILE_TOO_LARGE", 413)),
              UnknownFormat: () => Effect.succeed(refused("UNKNOWN_FORMAT", 422)),
              AccountNotFound: () => Effect.succeed(refused("ACCOUNT_NOT_FOUND", 422)),
              ImportUnavailable: () => Effect.succeed(refused("IMPORT_UNAVAILABLE", 503)),
            }),
          ),
        );
      },
    },
  },
});
