import type { Look } from "@gousset/core/look";

// A merchant's logo (#204), as the pages show it and upload it: `/api/merchants/$merchantId/logo`.

/**
 * What the logo's route answers a write: the logo's new version (null once removed), or a
 * refusal's code (`LOGO_TOO_LARGE`, `LOGO_TYPE`, `LOGO_EMPTY`, `MERCHANT_NOT_FOUND`,
 * `UPLOAD_FAILED`, `SIGN_IN_REQUIRED`, `PASSWORD_CHANGE_REQUIRED`).
 */
export type LogoAnswer = { readonly version: string | null } | { readonly refused: string };

/** The logo's address, its version named so that a browser keeps it; undefined for none. */
export function merchantLogoSrc(merchantId: string, look: Look): string | undefined {
  return look.logo === null
    ? undefined
    : `/api/merchants/${encodeURIComponent(merchantId)}/logo?v=${encodeURIComponent(look.logo)}`;
}
