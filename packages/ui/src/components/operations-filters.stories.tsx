import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { ACCOUNTS } from "../stories/made-up";
import { NO_OPERATIONS_FILTERS } from "../lib/operations";
import type { OperationsFilterValues } from "../lib/operations";
import { OperationsFilters } from "./operations-filters";

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

/** The bar holding its values, as the page would in its URL. */
function Controlled({ start }: { start: OperationsFilterValues }) {
  const [values, setValues] = useState(start);

  return <OperationsFilters values={values} onChange={setValues} accounts={ACCOUNT_CHOICES} />;
}

/**
 * The operations' filters (screen 2, block 1), controlled: words to search in the labels, the
 * account ("All accounts" first), the period (each bound clearable), the amount's bounds as typed
 * decimals (the page reads them, and gives an error to show when it cannot) and "To review only";
 * "Clear filters" once any is set. Each change goes to `onChange` at once: the page debounces the
 * search before asking the server. It wraps on a narrow screen.
 *
 * Motion: its fields' own (a select's list and a calendar fade in 150 ms); cut under reduced
 * motion.
 *
 * Don't: filter in the browser what the server pages, or send a request at each keystroke.
 */
const meta = {
  title: "Operations/OperationsFilters",
  component: OperationsFilters,
  args: { values: NO_OPERATIONS_FILTERS, onChange: () => undefined, accounts: ACCOUNT_CHOICES },
  render: (args) => <Controlled start={args.values} />,
} satisfies Meta<typeof OperationsFilters>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Nothing set: no "Clear filters". */
export const Default: Story = {};

/** Every filter set, and "Clear filters" to undo them. */
export const Set: Story = { args: { values: SET } };

/** A bound the page could not read. */
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

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { values: SET },
};
