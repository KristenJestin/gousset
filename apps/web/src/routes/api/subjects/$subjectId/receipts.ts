import { subjectReceiptsZip } from "@gousset/core";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Effect } from "effect";

import { attachmentDisposition } from "../../../../lib/content-disposition";
import type { ReceiptRefusal } from "../../../../lib/receipts";
import { usableSession } from "../../../../lib/session.server";
import { runCore } from "../../../../services";

const refused = (refusal: ReceiptRefusal, status: number) =>
  new Response(JSON.stringify(refusal), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });

/**
 * Every receipt of one of the signed-in user's subjects (#217) in one zip: those of every line its
 * expenses and its children's come from and of its payback lines, each named by its line's day and its own name, made as it
 * is downloaded. Another user's subject, or one that does not exist, is `SUBJECT_NOT_FOUND` alike;
 * a subject without a receipt gives an empty zip.
 */
export const Route = createFileRoute("/api/subjects/$subjectId/receipts")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { session, refusal } = await usableSession(request.headers);

        // A temporary password reads nothing: someone else chose it (#70, #79).
        if (session === undefined) {
          return refused({ refused: refusal }, refusal === "SIGN_IN_REQUIRED" ? 401 : 403);
        }

        return runCore(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            return yield* subjectReceiptsZip(session.user.id, params.subjectId, new Date(now));
          }).pipe(
            Effect.map(
              (zip) =>
                new Response(zip.content, {
                  headers: {
                    "Cache-Control": "private, no-store",
                    "Content-Type": "application/zip",
                    "Content-Disposition": attachmentDisposition(zip.fileName),
                  },
                }),
            ),
            Effect.catchTags({
              SubjectNotFound: () => Effect.succeed(refused({ refused: "SUBJECT_NOT_FOUND" }, 404)),
              ReceiptStorageFailed: () =>
                Effect.succeed(refused({ refused: "RECEIPT_UNAVAILABLE" }, 503)),
              QueryFailed: () => Effect.succeed(refused({ refused: "RECEIPT_UNAVAILABLE" }, 503)),
            }),
          ),
        );
      },
    },
  },
});
