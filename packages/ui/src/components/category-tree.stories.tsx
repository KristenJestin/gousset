import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { CategoryTree, CategoryTreeSkeleton } from "./category-tree";
import type { CategoryTreeRow } from "./category-tree";
import { MenuItem, MenuSeparator } from "./menu";

const eur = (minor: number) => [{ minor, currency: "EUR" }];

const ACTIONS = (
  <>
    <MenuItem icon="edit">Rename</MenuItem>
    <MenuItem>Move under…</MenuItem>
    <MenuItem>Merge with…</MenuItem>
    <MenuItem>Benchmark</MenuItem>
    <MenuSeparator />
    <MenuItem>Archive</MenuItem>
  </>
);

const ROWS: ReadonlyArray<CategoryTreeRow> = [
  {
    id: "housing",
    name: "Housing",
    icon: "housing",
    color: "blue",
    average: eur(69_000),
    benchmark: "automatic · €690",
    entries: 24,
    actions: ACTIONS,
  },
  {
    id: "rent",
    name: "Rent",
    child: true,
    icon: "rent",
    color: "blue",
    average: eur(61_000),
    benchmark: "automatic",
    entries: 6,
    actions: ACTIONS,
  },
  {
    id: "energy",
    name: "Energy",
    child: true,
    icon: "energy",
    // Its own colour, not its parent's.
    color: "amber",
    average: eur(8000),
    benchmark: "automatic",
    entries: 18,
    actions: ACTIONS,
  },
  {
    id: "groceries",
    name: "Groceries",
    icon: "groceries",
    color: "green",
    average: eur(58_000),
    benchmark: "automatic · €580",
    entries: 205,
    actions: ACTIONS,
  },
  {
    id: "eating-out",
    name: "Restaurants",
    child: true,
    icon: "restaurants",
    color: "green",
    average: eur(14_500),
    benchmark: "set · €130",
    benchmarkSet: true,
    entries: 70,
    actions: ACTIONS,
  },
  {
    id: "leisure",
    name: "Leisure",
    icon: "leisure",
    color: "violet",
    average: [
      { minor: 16_000, currency: "EUR" },
      { minor: 4000, currency: "USD" },
    ],
    benchmark: "none",
    entries: 41,
    actions: ACTIONS,
  },
  // No colour of its own nor a parent's, nor an icon: a neutral tile with `other`'s drawing.
  { id: "other", name: "Other", average: [], benchmark: "automatic", entries: 0, actions: ACTIONS },
];

/** A category added: it slides in from the side. */
function Adding() {
  const [added, setAdded] = useState(false);

  const rows: ReadonlyArray<CategoryTreeRow> = added
    ? [
        ...ROWS,
        {
          id: "pets",
          name: "Pets",
          icon: "pets",
          color: "teal",
          average: [],
          benchmark: "automatic",
          entries: 0,
          actions: ACTIONS,
          justCreated: true,
        },
      ]
    : ROWS;

  return (
    <div className="flex max-w-3xl flex-col items-start gap-4">
      <div className="w-full">
        <CategoryTree label="Expense categories" rows={rows} emptyText="No category." />
      </div>
      <Button variant="secondary" onClick={() => setAdded(!added)}>
        {added ? "Take Pets away" : "Add Pets"}
      </Button>
    </div>
  );
}

/**
 * A kind's categories on two levels (docs/wireframes, screen 10): each top-level category, then its
 * children indented under it, each with its icon on a tile of the colour it is shown in (its own,
 * else its parent's, #205; a neutral tile without one), the six-month average (one figure per currency, never
 * converted), the benchmark as the page words it (one set by the user in bold), the lines it holds
 * and a ⋮ menu of the page's actions, named after the category ("Actions on Groceries").
 *
 * Loading: `CategoryTreeSkeleton`, the same rows at the same heights.
 *
 * Motion: rows fade and slide up on first paint (200 ms, ease-out, staggered); a category just
 * added (`justCreated`) slides in from the side (200 ms). The menu opens as `Menu` (150 ms). Cut
 * under reduced motion.
 *
 * Don't: nest a third level (the core refuses it), or put a form in the menu: each action opens a
 * dialog.
 */
const meta = {
  title: "Categories/CategoryTree",
  component: CategoryTree,
  args: { label: "Expense categories", rows: ROWS, emptyText: "No category of this kind." },
  render: (args) => (
    <div className="max-w-3xl">
      <CategoryTree {...args} />
    </div>
  ),
} satisfies Meta<typeof CategoryTree>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No category in this view: the page's sentence. */
export const Empty: Story = { args: { rows: [], emptyText: "No archived category." } };

/** A category added from the page: it slides in. */
export const Added: Story = { render: () => <Adding /> };

export const Loading: Story = {
  render: () => (
    <div className="max-w-3xl">
      <CategoryTreeSkeleton rows={7} />
    </div>
  ),
};

export const French: Story = {
  args: {
    label: "Catégories de dépenses",
    rows: ROWS.map((row) => ({
      ...row,
      benchmark: row.benchmark
        .replace("automatic", "automatique")
        .replace("set", "fixé")
        .replace("none", "aucun"),
    })),
  },
  render: (args) => (
    <InFrench>
      <div className="max-w-3xl">
        <CategoryTree {...args} />
      </div>
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
