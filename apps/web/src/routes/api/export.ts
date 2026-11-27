import { DataExport } from "@gousset/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { usableSession } from "../../lib/session.server";
import { runCore } from "../../services";

const refused = (code: string, status: number) =>
  new Response(JSON.stringify({ refused: code }), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });

/**
 * The signed-in user's whole export (#22): a zip of their rows as JSON and CSV, the files they
 * imported, their receipts' files (#217), and a manifest, sent as it is made. A page of another site can make the browser download it, never read
 * it: it answers no CORS request, and the file lands on the user's own machine.
 */
export const Route = createFileRoute("/api/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { session, refusal } = await usableSession(request.headers);

        // A temporary password exports nothing: someone else chose it (#70, #79).
        if (session === undefined) {
          return refused(refusal, refusal === "SIGN_IN_REQUIRED" ? 401 : 403);
        }

        const archive = await runCore(
          Effect.gen(function* () {
            const data = yield* DataExport;

            return yield* data.archive(session.user.id);
          }),
        );

        return new Response(archive.content, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${archive.fileName}"`,
          },
        });
      },
    },
  },
});
