import { definePlugin } from "nitro";
import { fetchService } from "nitro/services";

/**
 * Nitro loads the app (TanStack Start's bundle, `src/server.ts`) at its first request. This asks
 * for `/health` as the server starts, so that the app loads then, and with it the job queue: a
 * restarted installation resumes its jobs at once, whether or not anyone visits.
 */
export default definePlugin(() => {
  void fetchService("ssr", "http://localhost/health").catch(() => {
    // The health check says what is wrong to whoever asks; the next request loads the app again.
  });
});
