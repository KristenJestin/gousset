import { describe, expect, test } from "vite-plus/test";

import { merchantLogoSrc } from "./merchant-logo";

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
