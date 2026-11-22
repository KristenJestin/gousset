import { createFileRoute } from "@tanstack/react-router";

import { auth, db } from "../services";

// The container's health check (Dockerfile, docker-compose.yml). It reads no session, so it stays
// open to anyone. It answers 200 only when the app can serve someone: the auth configuration
// loaded (better-auth refuses a production start without BETTER_AUTH_SECRET) and the database
// answers with the credentials given (a password changed on one side only fails here, not at the
// next sign-in). Compose restarts nothing on an unhealthy check: it reports it.
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

        try {
          await db.$client.query("select 1");
        } catch {
          return new Response("the database does not answer", { status: 503, headers });
        }

        return new Response("ok", { headers });
      },
    },
  },
});
