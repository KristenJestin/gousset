import { openReceipt } from "@gousset/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { attachmentDisposition } from "../../../lib/content-disposition";
import type { ReceiptRefusal } from "../../../lib/receipts";
import { usableSession } from "../../../lib/session.server";
import { runCore } from "../../../services";

const refused = (refusal: ReceiptRefusal, status: number) =>
  new Response(JSON.stringify(refusal), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });

/**
 * One of the signed-in user's receipts (#217), as it was attached, read from disk as it is sent.
 * Another user's, or one that does not exist, is `RECEIPT_NOT_FOUND` alike. Saved as a file, never
 * shown on this address: a receipt is the user's own upload, and its bytes are never run as a page.
 */
export const Route = createFileRoute("/api/receipts/$receiptId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { session, refusal } = await usableSession(request.headers);

        // A temporary password reads nothing: someone else chose it (#70, #79).
        if (session === undefined) {
          return refused({ refused: refusal }, refusal === "SIGN_IN_REQUIRED" ? 401 : 403);
        }

        return runCore(
          openReceipt(session.user.id, params.receiptId).pipe(
            Effect.map(
              ({ receipt, content }) =>
                new Response(content, {
                  headers: {
                    "Cache-Control": "private, no-store",
                    "Content-Type": receipt.mediaType,
                    "Content-Length": String(receipt.size),
                    "Content-Disposition": attachmentDisposition(receipt.fileName),
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "sandbox; default-src 'none'",
                  },
                }),
            ),
            Effect.catchTags({
              ReceiptNotFound: () => Effect.succeed(refused({ refused: "RECEIPT_NOT_FOUND" }, 404)),
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
