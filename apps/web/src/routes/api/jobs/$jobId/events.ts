import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { jobEvents } from "../../../../jobs/events.server";
import { jobs } from "../../../../jobs/runtime.server";
import { auth } from "../../../../services";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A job's progress, pushed to the page that follows it as Server-Sent Events (`useJob`): the
 * signed-in user's own jobs only; any other id is not found. The browser's EventSource connects
 * again by itself when the stream drops, an app restart included.
 */
export const Route = createFileRoute("/api/jobs/$jobId/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });

        if (!session) {
          return new Response("Sign in to follow a job.", { status: 401, headers: NO_STORE });
        }

        const body = await jobs.runPromise(
          jobEvents(params.jobId, session.user.id).pipe(
            Effect.catchTag("JobQueueUnavailable", () => Effect.succeed(undefined)),
          ),
        );

        if (body === undefined) {
          return new Response("The job queue does not answer: try again in a moment.", {
            status: 503,
            headers: { ...NO_STORE, "Retry-After": "5" },
          });
        }

        if (body === null) {
          return new Response("No job of yours has this id.", { status: 404, headers: NO_STORE });
        }

        if (body === "busy") {
          return new Response("You follow too many jobs at once: close a page that follows one.", {
            status: 429,
            headers: { ...NO_STORE, "Retry-After": "5" },
          });
        }

        return new Response(body, {
          headers: {
            ...NO_STORE,
            "Content-Type": "text/event-stream",
            // A reverse proxy must pass each event on at once, not hold the stream in a buffer.
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
