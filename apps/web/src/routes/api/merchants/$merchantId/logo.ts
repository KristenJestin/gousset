import { LOGO_MAX_BYTES, Merchants } from "@gousset/core";
import type { MerchantLogo } from "@gousset/core";
import { createFileRoute } from "@tanstack/react-router";
import { setResponseHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { boundedBody } from "../../../../lib/bounded-body";
import type { LogoAnswer } from "../../../../lib/merchant-logo";
import { usableSession } from "../../../../lib/session.server";
import { runCore } from "../../../../services";

// A merchant's logo (#204; docs/data-model.md, `merchant_logo`): the signed-in user's own, served
// from the database, never fetched from the web. Its address carries its version
// (`merchantLogoSrc`), so that a browser keeps it for good and asks again once it changes.

const NO_STORE = { "Cache-Control": "no-store" };

const json = (body: LogoAnswer, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, "Content-Type": "application/json" },
  });

const refused = (code: string, status: number) => json({ refused: code }, status);

/**
 * A logo refused as too large before its body was read whole: the connection closes with the
 * answer, so that a client never sends its next request on it under the bytes left unread, where
 * the server would reset it.
 */
const tooLarge = () =>
  new Response(JSON.stringify({ refused: "LOGO_TOO_LARGE" } satisfies LogoAnswer), {
    status: 413,
    headers: { ...NO_STORE, "Content-Type": "application/json", Connection: "close" },
  });

/** Why a logo is refused, by core's reason, with its status. */
const LOGO_REFUSALS = {
  empty: ["LOGO_EMPTY", 422],
  too_large: ["LOGO_TOO_LARGE", 413],
  type: ["LOGO_TYPE", 415],
} as const;

/**
 * The headers a logo is served with: its own type, never sniffed, and a policy that runs nothing
 * should the picture be opened as a page. Set on the response and on the request's, so that the
 * pages' own policy never replaces them.
 */
function logoHeaders(logo: MerchantLogo, asked: string | null) {
  const headers = new Headers({
    "Content-Type": logo.mediaType,
    "Content-Length": String(logo.content.byteLength),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // The user's own picture: kept by their browser alone, for good once its version is named.
    "Cache-Control":
      asked === logo.version ? "private, max-age=31536000, immutable" : "private, no-cache",
  });

  setResponseHeaders(headers);

  return headers;
}

/** The signed-in user, or the response that refuses the request. */
async function signedIn(request: Request) {
  const { session, refusal } = await usableSession(request.headers);

  // A temporary password reaches nothing: someone else chose it (#70, #79).
  return session === undefined
    ? { refusal: refused(refusal, refusal === "SIGN_IN_REQUIRED" ? 401 : 403) }
    : { owner: session.user.id };
}

/**
 * GET: the logo's bytes, with its stored type; `MERCHANT_NOT_FOUND` or `LOGO_NOT_FOUND` (404).
 * POST: sets it from the body's bytes (`application/octet-stream`, 256 KiB at most), answering its
 * `version`, or a refusal's code: `LOGO_TOO_LARGE`, `LOGO_TYPE` (neither PNG, JPEG nor WebP by its
 * bytes), `LOGO_EMPTY`, `MERCHANT_NOT_FOUND`. DELETE: removes it, answering `version: null`.
 * Every method refuses `SIGN_IN_REQUIRED` and `PASSWORD_CHANGE_REQUIRED`.
 */
export const Route = createFileRoute("/api/merchants/$merchantId/logo")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await signedIn(request);

        if (user.owner === undefined) {
          return user.refusal;
        }

        const asked = new URL(request.url).searchParams.get("v");

        return runCore(
          Effect.gen(function* () {
            const merchants = yield* Merchants;

            return yield* merchants.logo(user.owner, params.merchantId);
          }).pipe(
            Effect.map((logo) => new Response(logo.content, { headers: logoHeaders(logo, asked) })),
            Effect.catchTags({
              MerchantNotFound: () => Effect.succeed(refused("MERCHANT_NOT_FOUND", 404)),
              MerchantLogoNotFound: () => Effect.succeed(refused("LOGO_NOT_FOUND", 404)),
            }),
          ),
        );
      },

      POST: async ({ request, params }) => {
        // A page of another origin can send only a simple request without asking first: never
        // this type, which takes a preflight that no CORS answer allows (as `/api/imports`).
        if (request.headers.get("content-type") !== "application/octet-stream") {
          return refused("UPLOAD_FAILED", 415);
        }

        const user = await signedIn(request);

        if (user.owner === undefined) {
          return user.refusal;
        }

        const content = await boundedBody(request, LOGO_MAX_BYTES);

        if (content === undefined) {
          return tooLarge();
        }

        return runCore(
          Effect.gen(function* () {
            const merchants = yield* Merchants;

            return yield* merchants.setLogo(user.owner, params.merchantId, content);
          }).pipe(
            Effect.map((look) => json({ version: look.logo })),
            Effect.catchTags({
              MerchantLogoRefused: (refusal) => {
                const [code, status] = LOGO_REFUSALS[refusal.reason];

                return Effect.succeed(refused(code, status));
              },
              MerchantNotFound: () => Effect.succeed(refused("MERCHANT_NOT_FOUND", 404)),
            }),
          ),
        );
      },

      DELETE: async ({ request, params }) => {
        const user = await signedIn(request);

        if (user.owner === undefined) {
          return user.refusal;
        }

        return runCore(
          Effect.gen(function* () {
            const merchants = yield* Merchants;

            return yield* merchants.removeLogo(user.owner, params.merchantId);
          }).pipe(
            Effect.map(() => json({ version: null })),
            Effect.catchTags({
              MerchantNotFound: () => Effect.succeed(refused("MERCHANT_NOT_FOUND", 404)),
            }),
          ),
        );
      },
    },
  },
});
