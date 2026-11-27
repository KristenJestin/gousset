import { Result } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import {
  LOGO_MAX_BYTES,
  LOGO_VERSION_LENGTH,
  LOOK_COLORS,
  logoExtension,
  checkLogo,
  logoMediaTypeOf,
  lookOf,
} from "./look";
import { CATEGORY_COLORS } from "./category-looks";

// A merchant's look (#204): the palette's keys, and a logo recognised by its bytes alone. The
// pictures here are the first bytes of each format, made in code: no real logo.

const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_START = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const bytes = (...parts: ReadonlyArray<ReadonlyArray<number>>) => new Uint8Array(parts.flat());

/** A WebP file's header: `RIFF`, its size, `WEBP`. */
const webp = (rest: ReadonlyArray<number> = [0x56, 0x50, 0x38, 0x20]) =>
  bytes(RIFF, [0x1a, 0x00, 0x00, 0x00], WEBP, rest);

describe("the palette", () => {
  test("is the categories' own (#205): one palette, the same keys in the same order", () => {
    expect(LOOK_COLORS).toBe(CATEGORY_COLORS);
    expect(LOOK_COLORS).toEqual([
      "red",
      "orange",
      "amber",
      "olive",
      "green",
      "teal",
      "cyan",
      "blue",
      "indigo",
      "violet",
      "pink",
      "grey",
    ]);
  });
});

describe("a merchant's look as read", () => {
  test("keeps a key of the palette and the logo's version", () => {
    expect(lookOf("teal", "a".repeat(64))).toEqual({
      color: "teal",
      logo: "a".repeat(LOGO_VERSION_LENGTH),
    });
  });

  test("reads a key the palette does not have as automatic", () => {
    expect(lookOf("mauve", null)).toEqual({ color: null, logo: null });
    expect(lookOf("gray", null)).toEqual({ color: null, logo: null });
    expect(lookOf(null, null)).toEqual({ color: null, logo: null });
  });
});

describe("a logo's type, from its bytes", () => {
  test("recognises PNG, JPEG and WebP", () => {
    expect(logoMediaTypeOf(bytes(PNG_START, [0, 0, 0, 0x0d]))).toBe("image/png");
    expect(logoMediaTypeOf(bytes(JPEG_START, [0xe0]))).toBe("image/jpeg");
    expect(logoMediaTypeOf(webp())).toBe("image/webp");
  });

  test("refuses SVG, GIF, text, a RIFF that is no WebP, a cut header and nothing", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    expect(logoMediaTypeOf(svg)).toBeNull();
    expect(logoMediaTypeOf(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(logoMediaTypeOf(new TextEncoder().encode("a logo"))).toBeNull();
    expect(logoMediaTypeOf(bytes(RIFF, [0, 0, 0, 0], [0x41, 0x56, 0x49, 0x20]))).toBeNull();
    expect(logoMediaTypeOf(bytes(PNG_START.slice(0, 7)))).toBeNull();
    expect(logoMediaTypeOf(bytes(RIFF, [0, 0, 0, 0], WEBP.slice(0, 3)))).toBeNull();
    expect(logoMediaTypeOf(new Uint8Array())).toBeNull();
  });

  test("names each type's file extension", () => {
    expect(logoExtension("image/png")).toBe("png");
    expect(logoExtension("image/jpeg")).toBe("jpg");
    expect(logoExtension("image/webp")).toBe("webp");
  });

  test("never depends on what follows the header", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(bytes(PNG_START), bytes(JPEG_START), webp([])),
        fc.uint8Array({ maxLength: 64 }),
        (header, rest) => {
          expect(logoMediaTypeOf(bytes([...header], [...rest]))).toBe(logoMediaTypeOf(header));
        },
      ),
    );
  });

  test("gives a type only to bytes that start as one of the three", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 32 }), (any) => {
        const type = logoMediaTypeOf(any);
        const start = Array.from(any.subarray(0, 8));

        if (type === "image/png") {
          expect(start).toEqual(PNG_START);
        } else if (type === "image/jpeg") {
          expect(start.slice(0, 3)).toEqual(JPEG_START);
        } else if (type === "image/webp") {
          expect(Array.from(any.subarray(0, 4))).toEqual(RIFF);
          expect(Array.from(any.subarray(8, 12))).toEqual(WEBP);
        } else {
          expect(type).toBeNull();
        }
      }),
    );
  });
});

describe("a logo refused", () => {
  test("for nothing, too many bytes, or a type that is not one of the three", () => {
    expect(checkLogo(new Uint8Array())).toEqual(Result.fail("empty"));
    expect(checkLogo(new Uint8Array(LOGO_MAX_BYTES + 1).fill(0xff))).toEqual(
      Result.fail("too_large"),
    );
    expect(checkLogo(new TextEncoder().encode("<svg/>"))).toEqual(Result.fail("type"));
  });

  test("not when it is one of the three and at most 256 KiB", () => {
    const largest = new Uint8Array(LOGO_MAX_BYTES);

    largest.set(PNG_START);

    expect(LOGO_MAX_BYTES).toBe(262_144);
    expect(checkLogo(largest)).toEqual(Result.succeed("image/png"));
    expect(checkLogo(webp())).toEqual(Result.succeed("image/webp"));
  });
});
