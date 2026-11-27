import { attachReceipt } from "@gousset/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { drainedBody } from "../../../../lib/drained-body";
import type { ReceiptRefusal, ReceiptUploadAnswer } from "../../../../lib/receipts";
import { usableSession } from "../../../../lib/session.server";
import { receiptLimits } from "../../../../receipts.server";
import { runCore } from "../../../../services";

const NO_STORE = { "Cache-Control": "no-store" };

const json = (body: ReceiptUploadAnswer, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, "Content-Type": "application/json" },
  });

const refused = (refusal: ReceiptRefusal, status: number) => json(refusal, status);

/** The size the request declares, or `null` when it declares none a number reads. */
function declaredSize(headers: Headers): number | null {
  const declared = headers.get("content-length");
  const size = declared === null ? Number.NaN : Number(declared);

  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

/**
 * Attaches a receipt to one of the signed-in user's lines (#217): the body is the file's bytes,
 * `name` its name. The body is written to the receipts' directory as it arrives, never held whole,
 * and cut at the installation's limit; its kind is read from its first bytes. Answers the receipt,
 * or a refusal's code (`SIGN_IN_REQUIRED`, `PASSWORD_CHANGE_REQUIRED`, `UPLOAD_FAILED`,
 * `LINE_NOT_FOUND`, `RECEIPT_EMPTY`, `RECEIPT_TOO_LARGE` with `bytes` and `limit`, `RECEIPT_TYPE`
 * with `allowed`, `RECEIPT_UNAVAILABLE`).
 */
export const Route = createFileRoute("/api/lines/$lineId/receipts")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        // A page of another origin (a sibling subdomain, which the session cookie reaches) can
        // send only a simple request without asking first: never this type, which takes a
        // preflight that no CORS answer allows.
        if (request.headers.get("content-type") !== "application/octet-stream") {
          return refused({ refused: "UPLOAD_FAILED" }, 415);
        }

        const { session, refusal } = await usableSession(request.headers);

        // A temporary password attaches nothing: someone else chose it (#70, #79).
        if (session === undefined) {
          return refused({ refused: refusal }, refusal === "SIGN_IN_REQUIRED" ? 401 : 403);
        }

        // Read to its end whatever the answer, so that the client gets it rather than a cut
        // connection, up to twice the limit: past it, the connection is cut.
        const body = drainedBody(request.body ?? new Blob([]).stream(), 2 * receiptLimits.maxBytes);
        const fileName = (new URL(request.url).searchParams.get("name") ?? "").slice(0, 255);
        const declaredBytes = declaredSize(request.headers);

        const answer = await runCore(
          attachReceipt(
            session.user.id,
            params.lineId,
            { fileName, declaredBytes, body: body.stream },
            receiptLimits,
          ).pipe(
            Effect.map((receipt) => json({ receipt })),
            Effect.catchTags({
              LineNotFound: () => Effect.succeed(refused({ refused: "LINE_NOT_FOUND" }, 404)),
              ReceiptEmpty: () => Effect.succeed(refused({ refused: "RECEIPT_EMPTY" }, 422)),
              ReceiptTooLarge: (tooLarge) =>
                Effect.succeed(
                  refused(
                    { refused: "RECEIPT_TOO_LARGE", bytes: tooLarge.bytes, limit: tooLarge.limit },
                    413,
                  ),
                ),
              ReceiptTypeRefused: (wrong) =>
                Effect.succeed(refused({ refused: "RECEIPT_TYPE", allowed: wrong.allowed }, 415)),
              ReceiptStorageFailed: () =>
                Effect.succeed(refused({ refused: "RECEIPT_UNAVAILABLE" }, 503)),
              QueryFailed: () => Effect.succeed(refused({ refused: "RECEIPT_UNAVAILABLE" }, 503)),
            }),
          ),
        );

        // A client gone meanwhile is no failure of the receipt's.
        await body.drain().catch(() => undefined);

        return answer;
      },
    },
  },
});
