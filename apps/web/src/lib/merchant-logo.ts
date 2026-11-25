import type { Look } from "@gousset/core/look";
import { LOGO_MAX_BYTES, LogoMediaType } from "@gousset/core/look";
import type { AvatarFace } from "@gousset/ui/components/avatar";
import { Option, Schema } from "effect";

// A merchant's logo (#204), as the pages show it and upload it: `/api/merchants/$merchantId/logo`.

/**
 * What the logo's route answers a write: the logo's new version (null once removed), or a
 * refusal's code (`LOGO_TOO_LARGE`, `LOGO_TYPE`, `LOGO_EMPTY`, `MERCHANT_NOT_FOUND`,
 * `UPLOAD_FAILED`, `SIGN_IN_REQUIRED`, `PASSWORD_CHANGE_REQUIRED`).
 */
export const LogoAnswer = Schema.Union([
  Schema.Struct({ version: Schema.NullOr(Schema.String) }),
  Schema.Struct({ refused: Schema.String }),
]);

export type LogoAnswer = typeof LogoAnswer.Type;

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(LogoAnswer));

const isLogoType = Schema.is(LogoMediaType);

/** Where a merchant's logo is read, set and removed. */
const logoPath = (merchantId: string) => `/api/merchants/${encodeURIComponent(merchantId)}/logo`;

/** The logo's address, its version named so that a browser keeps it; undefined for none. */
export function merchantLogoSrc(merchantId: string, look: Look): string | undefined {
  return look.logo === null
    ? undefined
    : `${logoPath(merchantId)}?v=${encodeURIComponent(look.logo)}`;
}

/** A merchant named on a page, as its avatar draws it: its logo, or its initials on its colour. */
export function merchantAvatar(merchant: {
  readonly id: string;
  readonly name: string;
  readonly look: Look;
}): AvatarFace {
  return {
    name: merchant.name,
    src: merchantLogoSrc(merchant.id, merchant.look),
    color: merchant.look.color,
  };
}

/** Why a logo is refused before it is sent. */
export type LogoFileRefusal = "LOGO_EMPTY" | "LOGO_TOO_LARGE" | "LOGO_TYPE";

/**
 * Why a picked file cannot be a logo, before a byte is sent: empty, over 256 KiB, or not said to be
 * a PNG, JPEG or WebP picture by the browser. The server reads its bytes again, which alone decide.
 */
export function logoFileRefusal(file: File): LogoFileRefusal | undefined {
  if (file.size === 0) {
    return "LOGO_EMPTY";
  }

  if (file.size > LOGO_MAX_BYTES) {
    return "LOGO_TOO_LARGE";
  }

  return isLogoType(file.type) ? undefined : "LOGO_TYPE";
}

/** The answer a write gave, or `UPLOAD_FAILED` when it says nothing the page can read. */
async function answerOf(call: Promise<Response>): Promise<LogoAnswer> {
  try {
    const response = await call;

    // A refusal comes with its code in JSON (404, 413, 415, 422); any other failure (a proxy's
    // page, a crash) says nothing the page can read.
    const refusal = [404, 413, 415, 422].includes(response.status);

    if (!response.ok && !refusal) {
      return { refused: "UPLOAD_FAILED" };
    }

    return Option.getOrElse(decodeAnswer(await response.text()), () => ({
      refused: "UPLOAD_FAILED",
    }));
  } catch {
    return { refused: "UPLOAD_FAILED" };
  }
}

/**
 * Sets a merchant's logo from a picked file, refused here first when it cannot be one
 * (`logoFileRefusal`); the server checks its bytes and answers the logo's new version.
 */
export async function uploadMerchantLogo(merchantId: string, file: File): Promise<LogoAnswer> {
  const refused = logoFileRefusal(file);

  if (refused !== undefined) {
    return { refused };
  }

  return answerOf(
    fetch(logoPath(merchantId), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    }),
  );
}

/** Removes a merchant's logo: its avatar of initials is shown again. */
export function removeMerchantLogo(merchantId: string): Promise<LogoAnswer> {
  return answerOf(fetch(logoPath(merchantId), { method: "DELETE" }));
}
