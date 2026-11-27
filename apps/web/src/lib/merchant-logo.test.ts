import { describe, expect, test } from "vite-plus/test";

import { logoFileRefusal, merchantAvatar, merchantLogoSrc } from "./merchant-logo";

describe("merchantLogoSrc", () => {
  test("names the logo's version, so that a new logo is a new address", () => {
    expect(
      merchantLogoSrc("0190f000-0000-7000-8000-000000000001", {
        color: null,
        logo: "0123456789abcdef",
      }),
    ).toBe("/api/merchants/0190f000-0000-7000-8000-000000000001/logo?v=0123456789abcdef");
  });

  test("gives none for a merchant without a logo: its avatar is drawn", () => {
    expect(
      merchantLogoSrc("0190f000-0000-7000-8000-000000000001", { color: "teal", logo: null }),
    ).toBe(undefined);
  });
});

describe("merchantAvatar", () => {
  test("draws a merchant by its name, its logo's address and its colour", () => {
    expect(
      merchantAvatar({
        id: "0190f000-0000-7000-8000-000000000002",
        name: "Juniper Hardware",
        look: { color: "olive", logo: "fedcba9876543210" },
      }),
    ).toEqual({
      name: "Juniper Hardware",
      src: "/api/merchants/0190f000-0000-7000-8000-000000000002/logo?v=fedcba9876543210",
      color: "olive",
    });
  });
});

/** A file of `size` zero bytes, said to be of `type`, as a browser's picker gives it. */
const file = (size: number, type: string) => new File([new Uint8Array(size)], "logo", { type });

describe("logoFileRefusal", () => {
  test("takes a PNG, a JPEG or a WebP of 256 KiB at most", () => {
    expect(logoFileRefusal(file(262_144, "image/png"))).toBe(undefined);
    expect(logoFileRefusal(file(10, "image/jpeg"))).toBe(undefined);
    expect(logoFileRefusal(file(10, "image/webp"))).toBe(undefined);
  });

  test("refuses one byte over 256 KiB", () => {
    expect(logoFileRefusal(file(262_145, "image/png"))).toBe("LOGO_TOO_LARGE");
  });

  test("refuses an empty file, and any other type: SVG, GIF, text", () => {
    expect(logoFileRefusal(file(0, "image/png"))).toBe("LOGO_EMPTY");
    expect(logoFileRefusal(file(10, "image/svg+xml"))).toBe("LOGO_TYPE");
    expect(logoFileRefusal(file(10, "image/gif"))).toBe("LOGO_TYPE");
    expect(logoFileRefusal(file(10, ""))).toBe("LOGO_TYPE");
  });
});
