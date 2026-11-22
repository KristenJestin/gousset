// Made-up data for the stories, in one file, until `packages/fixture` has its generator (#9):
// then the stories switch to it and this file goes. Every name and figure here is invented.
// Money is in integer minor units (cents) with its currency, never a float.

import type { CategoryIconName } from "../components/icons";

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
  spent: MadeUpMoney;
  /** The six-month average this month is held against. */
  benchmark: MadeUpMoney;
};

export const CATEGORIES: ReadonlyArray<MadeUpCategory> = [
  { id: "housing", name: "Housing", icon: "housing", spent: eur(69_000), benchmark: eur(69_000) },
  {
    id: "groceries",
    name: "Groceries",
    icon: "groceries",
    spent: eur(43_000),
    benchmark: eur(39_500),
  },
  { id: "leisure", name: "Leisure", icon: "leisure", spent: eur(23_000), benchmark: eur(16_000) },
  {
    id: "transport",
    name: "Transport",
    icon: "transport",
    spent: eur(17_000),
    benchmark: eur(16_500),
  },
  {
    id: "restaurants",
    name: "Restaurants",
    icon: "restaurants",
    spent: eur(14_500),
    benchmark: eur(15_200),
  },
  { id: "health", name: "Health", icon: "health", spent: eur(9800), benchmark: eur(6000) },
  {
    id: "subscriptions",
    name: "Subscriptions",
    icon: "subscriptions",
    spent: eur(4847),
    benchmark: eur(4797),
  },
  { id: "gifts", name: "Gifts", icon: "gifts", spent: eur(0), benchmark: eur(3500) },
];

export const MERCHANTS = [
  { id: "greenmarket", name: "Greenmarket", spent: eur(31_240), visits: 9 },
  { id: "fuelstop", name: "Fuelstop", spent: eur(11_740), visits: 2 },
  { id: "corner-bistro", name: "Corner Bistro", spent: eur(5600), visits: 1 },
  { id: "streamly", name: "Streamly", spent: eur(949), visits: 1 },
  { id: "pixelplay", name: "Pixelplay", spent: eur(1499), visits: 1 },
] as const;

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

/** A month where more went out than came in: a car repair on top of the usual. */
export const OVERSPENT_FIGURES = {
  received: eur(312_000),
  spent: eur(329_500),
  saved: eur(20_000),
  left: eur(-37_500),
};
