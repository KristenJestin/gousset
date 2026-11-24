// Made-up rules for the stories of the rules' components (#25), from the wireframe's screen 9.
// Every label, merchant, account and figure here is invented.

import type { CategoryChoice } from "../components/category-picker";
import type { RulesListRow } from "../components/rules-list";
import type { RuleConditions } from "../lib/rule-fields";

/** The server's limits (`@gousset/core/rule-values`), as the page gives them. */
export const MAX_CONDITIONS = 10;
export const MAX_LABEL_TEXT = 200;

export const RULE_ACCOUNTS = [
  { id: "a1d1c3e0-0000-4000-8000-000000000001", name: "Current account" },
  { id: "a1d1c3e0-0000-4000-8000-000000000002", name: "Livret A" },
  { id: "a1d1c3e0-0000-4000-8000-000000000003", name: "MealCard" },
] as const;

const [CURRENT] = RULE_ACCOUNTS;

/** One condition on the label: what most rules are. */
export const labelContains = (text: string): RuleConditions => ({
  kind: "group",
  combinator: "and",
  children: [{ kind: "rule", field: "label", operator: "contains", value: text }],
});

export const RULE_MERCHANTS = [
  { id: "greenmarket", name: "Greenmarket" },
  { id: "pixelplay", name: "Pixelplay" },
  { id: "fuelstop", name: "Fuelstop" },
  { id: "harbor-savings", name: "Harbor Savings" },
  { id: "corner-bistro", name: "Corner Bistro" },
] as const;

export const RULE_CATEGORIES = {
  expense: [
    {
      id: "food",
      name: "Food",
      children: [
        { id: "groceries", name: "Groceries" },
        { id: "restaurants", name: "Restaurants" },
      ],
    },
    { id: "housing", name: "Housing", children: [{ id: "rent", name: "Rent" }] },
    { id: "leisure", name: "Leisure", children: [{ id: "games", name: "Video games" }] },
    { id: "transport", name: "Transport" },
  ],
  income: [
    { id: "salary", name: "Salary" },
    { id: "interest", name: "Interest" },
  ],
} satisfies { expense: ReadonlyArray<CategoryChoice>; income: ReadonlyArray<CategoryChoice> };

/** A rule on the amount and the day of the month: a loan paid early each month. */
export const LOAN_CONDITIONS: RuleConditions = {
  kind: "group",
  combinator: "and",
  children: [
    { kind: "rule", field: "amount", operator: "eq", value: 610 },
    { kind: "rule", field: "day", operator: "between", value: [3, 7] },
  ],
};

export const RULES: ReadonlyArray<RulesListRow> = [
  {
    id: "rule-greenmarket",
    conditions: labelContains("GREENMARKET"),
    merchant: "Greenmarket",
    category: "Food › Groceries",
    enabled: true,
    used: 128,
  },
  {
    id: "rule-pixelplay",
    conditions: labelContains("PAYLINK *PIXELPLAY"),
    merchant: "Pixelplay",
    category: "Leisure › Video games",
    enabled: true,
    used: 7,
  },
  {
    id: "rule-fuelstop",
    conditions: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "startsWith", value: "CB FUELSTOP" },
        { kind: "rule", field: "account", operator: "eq", value: CURRENT.id },
        { kind: "rule", field: "direction", operator: "eq", value: "out" },
      ],
    },
    merchant: "Fuelstop",
    category: null,
    enabled: true,
    used: 27,
  },
  {
    id: "rule-loan",
    conditions: LOAN_CONDITIONS,
    merchant: "Harbor Savings",
    category: "Housing",
    enabled: true,
    used: 36,
  },
  {
    id: "rule-summer",
    conditions: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "contains", value: "CORNER BISTRO" },
        { kind: "rule", field: "date", operator: "between", value: ["2026-07-01", "2026-08-31"] },
      ],
    },
    merchant: "Corner Bistro",
    category: "Food › Restaurants",
    enabled: true,
    used: 1,
  },
];

/** Labels as long as banks write them, and a rule of many conditions. */
export const LONG_RULES: ReadonlyArray<RulesListRow> = [
  {
    id: "rule-long-label",
    conditions: labelContains(
      "PRLV SEPA HARBOR SAVINGS MORTGAGE CONTRACT 00012345678 MONTHLY INSTALMENT OCTOBER",
    ),
    merchant: "Harbor Savings Mortgage And Home Insurance Department",
    category: "Housing › Mortgage and home insurance repayments",
    enabled: true,
    used: 1204,
  },
  {
    id: "rule-many-conditions",
    conditions: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "notContains", value: "REFUND" },
        { kind: "rule", field: "label", operator: "endsWith", value: "RIVERTON" },
        { kind: "rule", field: "amount", operator: "between", value: [12.5, 80] },
        { kind: "rule", field: "day", operator: "gte", value: 25 },
        { kind: "rule", field: "date", operator: "gte", value: "2026-01-01" },
        { kind: "rule", field: "direction", operator: "eq", value: "out" },
      ],
    },
    merchant: null,
    category: "Food › Groceries",
    enabled: true,
    used: 0,
  },
];

const MADE_UP_SHOPS = [
  "GREENMARKET",
  "CORNER BISTRO",
  "FUELSTOP",
  "STREAMLY",
  "PIXELPLAY",
  "NORTHWIND",
  "RIVER BOOKS",
  "BLUE TRAM",
];

/** `count` rules, the same for the same count, so that screenshots stay still. */
export function manyRules(count: number): ReadonlyArray<RulesListRow> {
  return Array.from({ length: count }, (_, index) => {
    const shop = MADE_UP_SHOPS[index % MADE_UP_SHOPS.length] ?? "GREENMARKET";

    return {
      id: `rule-${index}`,
      conditions: labelContains(`${shop} ${index + 1}`),
      merchant: null,
      category: index % 3 === 0 ? "Leisure" : "Food › Groceries",
      enabled: index % 7 !== 6,
      used: (index * 37) % 200,
    };
  });
}
