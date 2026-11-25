import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { ACCOUNTS } from "../stories/made-up";
import { NO_OPERATIONS_FILTERS } from "../lib/operations";
import type { OperationsFilterValues } from "../lib/operations";
import { ClearFilters, OperationsFilters } from "./operations-filters";

const ACCOUNT_CHOICES = ACCOUNTS.map((account) => ({ value: account.id, label: account.name }));

const SET: OperationsFilterValues = {
  search: "greenmarket",
  accountId: "current",
  from: "2026-10-01",
  to: "2026-10-31",
  min: "20",
  max: "",
  toReview: true,
};

/** The bar holding its values, as the page would in its URL, and "Clear filters" under it. */
function Controlled({ start }: { start: OperationsFilterValues }) {
  const [values, setValues] = useState(start);

  return (
    <div className="flex flex-col gap-3">
      <OperationsFilters
        values={values}
        onChange={setValues}
        accounts={ACCOUNT_CHOICES}
        count={1284}
      />
      <div className="flex h-8">
        <ClearFilters values={values} onChange={setValues} />
      </div>
    </div>
  );
}

/**
 * The operations' filters (screen 2, block 1), controlled: words to search in the labels, the
 * account ("All accounts" first), the period (each bound clearable), the amount's bounds as typed
 * decimals (the page reads them, and gives an error to show when it cannot) and "To review only".
 * Each change goes to `onChange` at once: the page debounces the search before asking the server.
 * `ClearFilters` ("Clear filters", once any is set) goes on the count's line.
 *
 * From 1,024 px of bar, one 32 px row with no label above any field: each says what it is by its
 * placeholder or its value and keeps its name for screen readers; the amount is one pair, "Amount
 * min – max"; "To review only" is a toggle button, its border, tint and words violet once pressed.
 * Narrower, the search and a Filters button with how many filters are set, which opens them in a
 * sheet, labelled one under the other ("To review only" a checkbox there); its button shows the
 * lines.
 *
 * Motion: the toggle's colours move in 150 ms; its fields' own (a select's list and a calendar fade in 150 ms) and the sheet's (it
 * slides in from its edge, about 300 ms); cut under reduced motion.
 *
 * Don't: filter in the browser what the server pages, send a request at each keystroke, or put a
 * label or a hint above or under a field of the row: it breaks the row's line. Don't put a checkbox
 * inside a bordered pill: the box and the pill's border double the pressed state.
 */
const meta = {
  title: "Operations/OperationsFilters",
  component: OperationsFilters,
  args: { values: NO_OPERATIONS_FILTERS, onChange: () => undefined, accounts: ACCOUNT_CHOICES },
  render: (args) => <Controlled start={args.values} />,
} satisfies Meta<typeof OperationsFilters>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Nothing set: no "Clear filters", and "To review only" not pressed. */
export const Default: Story = {};

/** Every filter set, "To review only" pressed, and "Clear filters" to undo them. */
export const Set: Story = { args: { values: SET } };

/** A bound the page could not read, said under the row. */
export const AmountError: Story = {
  args: { values: { ...NO_OPERATIONS_FILTERS, min: "12.5.0" }, minError: "Type an amount: 12.50" },
  render: (args) => <OperationsFilters {...args} />,
};

export const French: Story = {
  args: { values: SET },
  render: (args) => (
    <InFrench>
      <Controlled start={args.values} />
    </InFrench>
  ),
};

/** A phone: the search and the Filters button, which says how many are set and opens the sheet. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { values: SET },
};

export const PhoneInFrench: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { values: SET },
  render: (args) => (
    <InFrench>
      <Controlled start={args.values} />
    </InFrench>
  ),
};
