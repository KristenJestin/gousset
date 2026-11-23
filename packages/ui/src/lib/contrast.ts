// WCAG contrast of the theme's colours, read from `globals.css` itself: the unit test and the
// token story measure the same declarations the browser gets, so the figures cannot drift from
// the palette.

export type ColorScheme = "light" | "dark";

/** A colour in linear sRGB, each channel clipped to 0..1. */
export type LinearRgb = { readonly r: number; readonly g: number; readonly b: number };

/** A colour in OKLCH: lightness 0..1, chroma, hue in degrees. */
export type Oklch = { readonly l: number; readonly c: number; readonly h: number };

/** Every text colour of the theme, on every surface it is set on. */
export const TEXT_PAIRS = [
  ["--foreground", "--background"],
  ["--foreground", "--muted"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--card"],
  ["--muted-foreground", "--muted"],
  ["--primary-foreground", "--primary"],
  ["--primary", "--background"],
  ["--primary", "--card"],
  ["--destructive", "--background"],
  ["--destructive", "--card"],
  ["--money-spent", "--background"],
  ["--money-spent", "--card"],
  ["--money-saved", "--background"],
  ["--money-saved", "--card"],
  ["--money-left", "--background"],
  ["--money-left", "--card"],
  ["--money-income", "--background"],
  ["--money-income", "--card"],
  ["--money-restricted", "--background"],
  ["--money-restricted", "--card"],
  ["--chart-label", "--chart-background"],
  ["--chart-tooltip-foreground", "--chart-tooltip-background"],
  ["--chart-tooltip-muted", "--chart-tooltip-background"],
] as const;

/**
 * The edge of a floating surface (menu, popover, list, tooltip, toast, dialog), against every
 * surface it opens over and its own inside (docs/design.md, "Floating surfaces").
 */
export const EDGE_PAIRS = [
  ["--popover-border", "--background"],
  ["--popover-border", "--card"],
  ["--popover-border", "--sidebar"],
  ["--popover-border", "--popover"],
] as const;

/** The least contrast of a floating surface's edge, in both schemes. */
export const EDGE_MINIMUM = 1.7;

/** The colours of money, which the accent must never be read as. */
export const MONEY_COLORS = [
  "--money-spent",
  "--money-saved",
  "--money-left",
  "--money-income",
] as const;

const DECLARATION = /^\s*(--[a-z0-9-]+):\s*([^;]+);/gm;
const LIGHT_DARK = /^light-dark\((.+),\s*([^,]+)\)$/;
const VAR = /^var\((--[a-z0-9-]+)\)$/;
const OKLCH = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/;
const HEX = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

/** The first declaration of each custom property in a stylesheet: the theme's own. */
export function readDeclarations(css: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();

  for (const [, name, value] of css.matchAll(DECLARATION)) {
    if (name !== undefined && value !== undefined && !declarations.has(name)) {
      declarations.set(name, value.trim());
    }
  }

  return declarations;
}

/** A token's colour in one scheme, following `light-dark()` and `var()`. */
export function resolveColor(
  declarations: ReadonlyMap<string, string>,
  name: string,
  scheme: ColorScheme,
): Oklch {
  const value = declarations.get(name);

  if (value === undefined) {
    throw new Error(`${name} is not declared`);
  }

  return parseColor(declarations, value, scheme);
}

function parseColor(
  declarations: ReadonlyMap<string, string>,
  value: string,
  scheme: ColorScheme,
): Oklch {
  const pair = LIGHT_DARK.exec(value);

  if (pair?.[1] !== undefined && pair[2] !== undefined) {
    return parseColor(declarations, (scheme === "light" ? pair[1] : pair[2]).trim(), scheme);
  }

  const reference = VAR.exec(value)?.[1];

  if (reference !== undefined) {
    return resolveColor(declarations, reference, scheme);
  }

  const [, l, c, h] = OKLCH.exec(value) ?? [];

  if (l !== undefined && c !== undefined && h !== undefined) {
    return { l: Number(l), c: Number(c), h: Number(h) };
  }

  if (HEX.test(value)) {
    return toOklch(hexToLinearRgb(value));
  }

  throw new Error(`${value} is not an opaque oklch() or #rrggbb colour, a var() or a light-dark()`);
}

function clip(channel: number): number {
  return Math.min(1, Math.max(0, channel));
}

function linearize(channel: string): number {
  const value = Number.parseInt(channel, 16) / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** OKLCH to linear sRGB (Björn Ottosson's matrices), clipped to the sRGB gamut. */
export function toLinearRgb(color: Oklch): LinearRgb {
  const radians = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(radians);
  const b = color.c * Math.sin(radians);
  const l = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** Linear sRGB to OKLCH, the inverse of `toLinearRgb`. */
export function toOklch(color: LinearRgb): Oklch {
  const l = Math.cbrt(0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b);
  const m = Math.cbrt(0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b);
  const s = Math.cbrt(0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, b),
    h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  };
}

/** A `#rrggbb` colour in linear sRGB. */
export function hexToLinearRgb(hex: string): LinearRgb {
  const [, r, g, b] = HEX.exec(hex) ?? [];

  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`${hex} is not a #rrggbb colour`);
  }

  return { r: linearize(r), g: linearize(g), b: linearize(b) };
}

/** WCAG relative luminance. */
export function luminance(color: LinearRgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(first: LinearRgb, second: LinearRgb): number {
  const [lighter, darker] = [luminance(first), luminance(second)].toSorted((x, y) => y - x);

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** The shortest distance between two hues, in degrees. */
export function hueDistance(first: Oklch, second: Oklch): number {
  const distance = Math.abs(first.h - second.h) % 360;

  return Math.min(distance, 360 - distance);
}

export type MeasuredPair = {
  readonly text: string;
  readonly surface: string;
  readonly light: number;
  readonly dark: number;
};

/** The contrast of every text pair, in both schemes. */
export function measureTextPairs(css: string): ReadonlyArray<MeasuredPair> {
  return measurePairs(css, TEXT_PAIRS);
}

/** The contrast of a floating surface's edge on every surface around it, in both schemes. */
export function measureEdgePairs(css: string): ReadonlyArray<MeasuredPair> {
  return measurePairs(css, EDGE_PAIRS);
}

function measurePairs(
  css: string,
  pairs: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<MeasuredPair> {
  const declarations = readDeclarations(css);

  const ratio = (text: string, surface: string, scheme: ColorScheme) =>
    contrastRatio(
      toLinearRgb(resolveColor(declarations, text, scheme)),
      toLinearRgb(resolveColor(declarations, surface, scheme)),
    );

  return pairs.map(([text, surface]) => ({
    text,
    surface,
    light: ratio(text, surface, "light"),
    dark: ratio(text, surface, "dark"),
  }));
}
