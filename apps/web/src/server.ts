import { paraglideMiddleware } from "@gousset/i18n/server";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

/**
 * Every request runs in its own language (Paraglide's request-scoped locale): the language cookie
 * the user chose, else the browser's `Accept-Language`, else English. The original request goes
 * on: no locale lives in the URL.
 */
export default createServerEntry({
  fetch: async (request, options) =>
    paraglideMiddleware(request, async () => handler.fetch(request, options)),
});
