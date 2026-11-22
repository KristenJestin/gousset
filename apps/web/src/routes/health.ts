import { createFileRoute } from "@tanstack/react-router";

import { auth } from "../services";

// The container's health check (Dockerfile, docker-compose.yml). It reads no session, so it stays
// open to anyone. It answers 200 only once the auth configuration loaded (better-auth refuses a
// production start without BETTER_AUTH_SECRET): an app whose sign-in is broken is not healthy. It
// does not query the database, so that a database restart does not get the app restarted too.
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        const headers = { "Cache-Control": "no-store" };

        try {
          await auth.$context;
        } catch {
          return new Response("the auth configuration did not load", { status: 503, headers });
        }

        return new Response("ok", { headers });
      },
    },
  },
});
