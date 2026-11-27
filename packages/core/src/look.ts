import { Result, Schema } from "effect";

import { CATEGORY_COLORS } from "./category-looks";

// How a merchant is shown (#204; docs/data-model.md, v0.3): a logo the user uploaded, or an avatar
// of its initials on a colour of a fixed palette, the automatic one (chosen from its name by
// packages/ui) until the user picks one. Pure: no database, no Effect service. Kept generic: a
// bank (#209) will be shown the same way.

/**
 * The palette's keys, in its order: the categories' own (#205, `./category-looks`), so that there
 * is one palette, each key drawn and checked for contrast once.
 */
export const LOOK_COLORS = CATEGORY_COLORS;

/** A colour of the palette, by its key. */
export const LookColor = Schema.Literals(LOOK_COLORS);

export type LookColor = typeof LookColor.Type;

/** How something is shown wherever it is named. */
export type Look = {
  /** The colour its avatar is drawn on; null for the automatic one. */
  readonly color: LookColor | null;
  /** Its logo's version, which its address carries; null for none: its avatar is shown. */
  readonly logo: string | null;
};

/** The largest logo, in bytes: 256 KiB, as the database checks it too. */
export const LOGO_MAX_BYTES = 262_144;

/** How many hexadecimal characters of a logo's SHA-256 make its version. */
export const LOGO_VERSION_LENGTH = 16;

/** The pictures a logo may be: never SVG, which can carry a script. */
export const LogoMediaType = Schema.Literals(["image/png", "image/jpeg", "image/webp"]);

export type LogoMediaType = typeof LogoMediaType.Type;

/** Why a logo is refused: no byte, more than `LOGO_MAX_BYTES`, or neither PNG, JPEG nor WebP. */
export type LogoRefusal = "empty" | "too_large" | "type";

const isLookColor = Schema.is(LookColor);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const startsWith = (bytes: Uint8Array, expected: ReadonlyArray<number>, at = 0) =>
  bytes.length >= at + expected.length &&
  expected.every((byte, index) => bytes[at + index] === byte);

/**
 * The type of a picture, read from its first bytes alone (never its name nor a declared type):
 * PNG's signature, JPEG's start of image, WebP's `RIFF` then `WEBP`; null for anything else.
 */
export function logoMediaTypeOf(bytes: Uint8Array): LogoMediaType | null {
  if (startsWith(bytes, PNG)) {
    return "image/png";
  }

  if (startsWith(bytes, JPEG)) {
    return "image/jpeg";
  }

  return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8) ? "image/webp" : null;
}

/** A logo's type, or why it is refused. */
export function checkLogo(bytes: Uint8Array): Result.Result<LogoMediaType, LogoRefusal> {
  if (bytes.length === 0) {
    return Result.fail("empty");
  }

  if (bytes.length > LOGO_MAX_BYTES) {
    return Result.fail("too_large");
  }

  const type = logoMediaTypeOf(bytes);

  return type === null ? Result.fail("type") : Result.succeed(type);
}

/** The extension a file of that type takes, in an export. */
export function logoExtension(type: LogoMediaType): "png" | "jpg" | "webp" {
  switch (type) {
    case "image/png": {
      return "png";
    }

    case "image/jpeg": {
      return "jpg";
    }

    case "image/webp": {
      return "webp";
    }
  }
}

/** A logo's version: the start of its SHA-256. */
export const logoVersion = (sha256: string) => sha256.slice(0, LOGO_VERSION_LENGTH);

/**
 * A look as stored: a colour's key (one the palette no longer has reads as automatic) and the
 * logo's SHA-256, null for none.
 */
export function lookOf(color: string | null, sha256: string | null): Look {
  return {
    color: color !== null && isLookColor(color) ? color : null,
    logo: sha256 === null ? null : logoVersion(sha256),
  };
}
