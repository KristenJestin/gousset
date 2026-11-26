import { readFileSync } from "node:fs";

import { CATEGORY_COLORS } from "@gousset/core/category-looks";
import { describe, expect, it } from "vite-plus/test";

import {
  EDGE_MINIMUM,
  MONEY_COLORS,
  contrastRatio,
  hexToLinearRgb,
  hueDistance,
  measureEdgePairs,
  measurePalette,
  measureTextPairs,
  over,
  readDeclarations,
  resolveColor,
  toLinearRgb,
  toOklch,
} from "./contrast";
import { THEME_COLORS } from "./theme-color";

const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

describe("contrast", () => {
  it("measures black on white at 21:1", () => {
    expect(contrastRatio(hexToLinearRgb("#000000"), hexToLinearRgb("#ffffff"))).toBeCloseTo(21, 5);
  });

  it("measures the brand violet on white as WCAG does", () => {
    // #6a44c8 on white is 6.41:1 by the WCAG formula.
    expect(contrastRatio(hexToLinearRgb("#6a44c8"), hexToLinearRgb("#ffffff"))).toBeCloseTo(
      6.41,
      2,
    );
  });

  it("blends a colour over a surface as the browser does, in encoded sRGB", () => {
    // Black at half over white is #808080, not #bcbcbc, the mean of linear light.
    const half = over(hexToLinearRgb("#000000"), hexToLinearRgb("#ffffff"), 0.5);

    expect(half.r).toBeCloseTo(hexToLinearRgb("#808080").r, 2);
  });

  it("converts white and the brand violet to OKLCH and back", () => {
    const white = toLinearRgb({ l: 1, c: 0, h: 0 });

    expect(white.r).toBeCloseTo(1, 3);
    expect(white.g).toBeCloseTo(1, 3);
    expect(white.b).toBeCloseTo(1, 3);

    const violet = hexToLinearRgb("#6a44c8");
    const back = toLinearRgb(toOklch(violet));

    expect(back.r).toBeCloseTo(violet.r, 6);
    expect(back.g).toBeCloseTo(violet.g, 6);
    expect(back.b).toBeCloseTo(violet.b, 6);
    expect(toOklch(violet).h).toBeGreaterThan(280);
    expect(toOklch(violet).h).toBeLessThan(300);
  });
});

describe("the theme", () => {
  it.each(measureTextPairs(css))("sets $text on $surface at 4.5:1 or more", (pair) => {
    expect(pair.light).toBeGreaterThanOrEqual(4.5);
    expect(pair.dark).toBeGreaterThanOrEqual(4.5);
  });

  it.each(measureEdgePairs(css))(
    "draws the edge of a floating surface ($text) on $surface at 1.7:1 or more",
    (pair) => {
      expect(pair.light).toBeGreaterThanOrEqual(EDGE_MINIMUM);
      expect(pair.dark).toBeGreaterThanOrEqual(EDGE_MINIMUM);
    },
  );

  it.each(measurePalette(css, CATEGORY_COLORS))(
    "draws the palette's $color on $on at 4.5:1 or more",
    (swatch) => {
      expect(swatch.light).toBeGreaterThanOrEqual(4.5);
      expect(swatch.dark).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("declares one palette colour per key of the categories' palette, and no other", () => {
    const declared = [...readDeclarations(css).keys()].flatMap((name) =>
      name.startsWith("--palette-") ? [name.slice("--palette-".length)] : [],
    );

    expect(declared).toEqual([...CATEGORY_COLORS]);
  });

  it("gives floating surfaces their own edge and shadow, not the blocks' border", () => {
    const declarations = readDeclarations(css);

    expect(declarations.get("--popover-border")).not.toBe(declarations.get("--border"));
    expect(declarations.get("--popover-shadow")).toContain("light-dark(");
  });

  it.each(["light", "dark"] as const)(
    "keeps the accent apart from every money colour in %s",
    (scheme) => {
      const declarations = readDeclarations(css);
      const primary = resolveColor(declarations, "--primary", scheme);

      for (const money of MONEY_COLORS) {
        expect(
          hueDistance(primary, resolveColor(declarations, money, scheme)),
        ).toBeGreaterThanOrEqual(45);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps the success colour apart from every money colour in %s",
    (scheme) => {
      const declarations = readDeclarations(css);
      const success = resolveColor(declarations, "--success", scheme);

      for (const money of MONEY_COLORS) {
        expect(
          hueDistance(success, resolveColor(declarations, money, scheme)),
        ).toBeGreaterThanOrEqual(45);
      }
    },
  );

  it("uses the brand violet as the accent and the focus ring", () => {
    const declarations = readDeclarations(css);

    expect(declarations.get("--primary")).toBe("light-dark(var(--brand-light), var(--brand-dark))");
    expect(declarations.get("--ring")).toBe("var(--primary)");
  });

  it.each(["light", "dark"] as const)(
    "gives the browser's bars the page's background in %s (theme-color)",
    (scheme) => {
      const background = toLinearRgb(resolveColor(readDeclarations(css), "--background", scheme));

      // The hex is the token rounded to 8 bits a channel: no step the eye sees between the two.
      expect(contrastRatio(hexToLinearRgb(THEME_COLORS[scheme]), background)).toBeLessThan(1.01);
    },
  );
});
