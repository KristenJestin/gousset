// Made-up data for the stories, in one file, until `packages/fixture` has its generator (#9):
// then the stories switch to it and this file goes. Every name and figure here is invented.
// Money is in integer minor units (cents) with its currency, never a float.

import type { CategoryIconName } from "../components/icons";
import type { PaletteColor } from "../lib/palette";

export type MadeUpMoney = { minor: number; currency: string };

const eur = (minor: number): MadeUpMoney => ({ minor, currency: "EUR" });

/** The month on screen and the one before. */
export const MONTH = { year: 2026, month: 10 } as const;

/** What came in, cut by role (docs/design.md, "One colour per role"). */
export const MONTH_FIGURES = {
  received: eur(312_000),
  spent: eur(203_000),
  saved: eur(60_000),
  left: eur(49_000),
  previous: { received: eur(305_000), spent: eur(193_400), saved: eur(55_000), left: eur(56_600) },
};

export const ACCOUNTS = [
  { id: "current", name: "Current account", kind: "current", balance: eur(184_250) },
  { id: "livret", name: "Livret A", kind: "savings", balance: eur(1_250_000) },
  { id: "mealcard", name: "MealCard", kind: "benefit", balance: eur(31_240) },
  { id: "pea", name: "Northbank PEA", kind: "investment", balance: eur(418_000) },
] as const;

export type MadeUpCategory = {
  id: string;
  name: string;
  icon: CategoryIconName;
  /** The colour it is shown in (#205). */
  color: PaletteColor;
  spent: MadeUpMoney;
  /** The six-month average this month is held against. */
  benchmark: MadeUpMoney;
};

export const CATEGORIES: ReadonlyArray<MadeUpCategory> = [
  {
    id: "housing",
    name: "Housing",
    icon: "housing",
    color: "blue",
    spent: eur(69_000),
    benchmark: eur(69_000),
  },
  {
    id: "groceries",
    name: "Groceries",
    icon: "groceries",
    color: "green",
    spent: eur(43_000),
    benchmark: eur(39_500),
  },
  {
    id: "leisure",
    name: "Leisure",
    icon: "leisure",
    color: "violet",
    spent: eur(23_000),
    benchmark: eur(16_000),
  },
  {
    id: "transport",
    name: "Transport",
    icon: "transport",
    color: "cyan",
    spent: eur(17_000),
    benchmark: eur(16_500),
  },
  {
    id: "restaurants",
    name: "Restaurants",
    icon: "restaurants",
    color: "orange",
    spent: eur(14_500),
    benchmark: eur(15_200),
  },
  {
    id: "health",
    name: "Health",
    icon: "health",
    color: "red",
    spent: eur(9800),
    benchmark: eur(6000),
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    icon: "subscriptions",
    color: "indigo",
    spent: eur(4847),
    benchmark: eur(4797),
  },
  {
    id: "gifts",
    name: "Gifts",
    icon: "gifts",
    color: "amber",
    spent: eur(0),
    benchmark: eur(3500),
  },
];

export const MERCHANTS = [
  { id: "greenmarket", name: "Greenmarket", spent: eur(31_240), visits: 9 },
  { id: "fuelstop", name: "Fuelstop", spent: eur(11_740), visits: 2 },
  { id: "corner-bistro", name: "Corner Bistro", spent: eur(5600), visits: 1 },
  { id: "streamly", name: "Streamly", spent: eur(949), visits: 1 },
  { id: "pixelplay", name: "Pixelplay", spent: eur(1499), visits: 1 },
] as const;

/**
 * A made-up logo, drawn here as an SVG data address: no image of a real brand, no request to anyone.
 * Only stories show an SVG; the app takes PNG, JPEG or WebP alone.
 */
export const MADE_UP_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2f6b4f"/><path d="M12 26c4-10 12-10 16 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
)}`;

/**
 * Money spent so far, day by day, this month (to the 24th) and the month before, for the area
 * chart with the previous period dashed. Cumulative, in cents.
 */
export const DAILY_SPENDING = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;

  // A made-up but plausible curve: rent on the 5th, groceries every few days, a steady drip.
  const curve = (shift: number) =>
    (day >= 5 ? 61_000 : 0) + day * (3400 + shift) + Math.floor(day / 3) * 2900;

  return {
    date: new Date(MONTH.year, MONTH.month - 1, day),
    current: day <= 24 ? curve(0) : null,
    previous: curve(-250),
  };
});

/** Spending of the last six months, for the bar chart. */
export const MONTHLY_SPENDING = [
  { date: new Date(2026, 4, 1), spent: eur(184_000) },
  { date: new Date(2026, 5, 1), spent: eur(162_000) },
  { date: new Date(2026, 6, 1), spent: eur(211_000) },
  { date: new Date(2026, 7, 1), spent: eur(179_000) },
  { date: new Date(2026, 8, 1), spent: eur(193_400) },
  { date: new Date(2026, 9, 1), spent: eur(203_000) },
];

// Money (Amount, Delta, MonthBar, Breakdown): the month before, and a month that went over.

/** What each category spent the month before, for the stories that switch months. */
const PREVIOUS_SPENT = new Map([
  ["housing", 69_000],
  ["groceries", 37_900],
  ["leisure", 14_800],
  ["transport", 17_900],
  ["restaurants", 17_800],
  ["health", 5700],
  ["subscriptions", 4847],
  ["gifts", 3500],
]);

export const PREVIOUS_CATEGORIES: ReadonlyArray<MadeUpCategory> = CATEGORIES.map((category) => ({
  ...category,
  spent: eur(PREVIOUS_SPENT.get(category.id) ?? 0),
}));

/** A statement line on the operations screen, its day and account already worded. */
export type MadeUpOperation = {
  id: string;
  day: string;
  label: string;
  account: string;
  amount: MadeUpMoney;
  toReview?: boolean;
};

/** The raw labels the made-up lines take, with their account and usual amount, in cents. */
const STATEMENT_LINES = [
  { label: "CB GREENMARKET 2110 RIVERTON", account: "Current account", minor: -5200 },
  { label: "MEALCARD GREENMARKET RIVERTON", account: "MealCard", minor: -2800 },
  { label: "PAYLINK *PIXELPLAY", account: "Current account", minor: -1499 },
  { label: "CB FUELSTOP 19/10", account: "Current account", minor: -5870 },
  { label: "PRLV SEPA STREAMLY", account: "Current account", minor: -949 },
  { label: "CB CORNER BISTRO 12/10", account: "Current account", minor: -5600 },
  { label: "PRLV HARBOR SAVINGS LOAN", account: "Current account", minor: -61_000 },
  { label: "VIR NORTHWIND SALARY", account: "Current account", minor: 312_000 },
  { label: "CB CORNER PHARMACY", account: "Current account", minor: -1960 },
  { label: "VIR LIVRET A INTERETS", account: "Livret A", minor: 1840 },
] as const;

const MONTHS = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "Jun.",
  "Jul.",
  "Aug.",
  "Sep.",
  "Oct.",
  "Nov.",
  "Dec.",
];

/**
 * `count` made-up statement lines, newest first from 31 October 2026, about three a day: the same
 * lines for the same count, so that screenshots stay still. Every seventh is held for review.
 */
export function madeUpOperations(count: number): Array<MadeUpOperation> {
  return Array.from({ length: count }, (_, index) => {
    const line =
      STATEMENT_LINES[(index * 7 + Math.floor(index / 3)) % STATEMENT_LINES.length] ??
      STATEMENT_LINES[0];

    const date = new Date(Date.UTC(2026, 9, 31 - Math.floor(index / 3)));
    // A spread around the usual amount, the same each time: 70% to 130%.
    const spread = 70 + ((index * 37) % 61);

    return {
      id: `line-${index}`,
      day: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""}`,
      label: line.label,
      account: line.account,
      amount: eur(Math.round((line.minor * spread) / 100)),
      toReview: index % 7 === 3,
    };
  });
}

/** A month where more went out than came in: a car repair on top of the usual. */
export const OVERSPENT_FIGURES = {
  received: eur(312_000),
  spent: eur(329_500),
  saved: eur(20_000),
  left: eur(-37_500),
};
