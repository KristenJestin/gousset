import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { CategoryPicker } from "./category-picker";
import type { CategoryChoice } from "./category-picker";

const EXPENSES: ReadonlyArray<CategoryChoice> = [
  {
    id: "housing",
    name: "Housing",
    icon: "housing",
    color: "blue",
    children: [
      { id: "rent", name: "Rent", icon: "rent", color: "blue" },
      { id: "energy", name: "Energy", icon: "energy", color: "amber" },
    ],
  },
  {
    id: "groceries",
    name: "Groceries",
    icon: "groceries",
    color: "green",
    children: [
      { id: "supermarket", name: "Supermarket", icon: "supermarket", color: "green" },
      { id: "bakery", name: "Bakery", icon: "bakery", color: "green" },
    ],
  },
  {
    id: "leisure",
    name: "Leisure",
    icon: "leisure",
    color: "violet",
    children: [{ id: "sport", name: "Sport", icon: "sport", color: "violet" }],
  },
  // No icon nor colour: `other`'s drawing, muted.
  { id: "other", name: "Other" },
];

/** The picker, with the id chosen written under it so it can be seen to change. */
function Choosing({ initial }: { initial: string | null }) {
  const [chosen, setChosen] = useState(initial);

  return (
    <div className="flex max-w-xs flex-col gap-3">
      <CategoryPicker
        label="Category"
        placeholder="Search a category"
        categories={EXPENSES}
        value={chosen}
        onValueChange={setChosen}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        Chosen: {chosen ?? "nothing"}
      </p>
    </div>
  );
}

/**
 * One category among the user's, found by typing (a `Combobox`): each top-level category, then its
 * children named with it ("Groceries › Bakery"), so typing a parent's name finds its children too.
 * Each shows its icon in the colour it is shown in (#205), in the list and once chosen. The page
 * gives only the categories that may be chosen (of the line's kind, not archived), each with the
 * colour it is shown in: a child's own, else its parent's.
 *
 * Motion: as `Combobox`, the list fades and grows in 150 ms, ease-out. Cut under reduced motion.
 *
 * Don't: offer archived categories, or both kinds at once: a line's kind follows its sign.
 */
const meta = {
  title: "Categories/CategoryPicker",
  component: Choosing,
  args: { initial: null },
} satisfies Meta<typeof Choosing>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A child chosen: its parent's name before its own. */
export const Chosen: Story = { args: { initial: "bakery" } };

export const French: Story = {
  render: () => (
    <InFrench>
      <div className="flex max-w-xs flex-col gap-3">
        <CategoryPicker
          label="Catégorie"
          placeholder="Chercher une catégorie"
          categories={[
            { id: "courses", name: "Courses", children: [{ id: "marche", name: "Marché" }] },
            { id: "autre", name: "Autre" },
          ]}
          value="marche"
          onValueChange={() => undefined}
        />
      </div>
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
