import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { MoneyField } from "./money-field";
import { Select } from "./select";

/** The field, with the minor units it reads back written under it. */
function Reading() {
  const [minor, setMinor] = useState<number | null>(186_000);

  return (
    <div className="flex max-w-xs flex-col gap-3">
      <MoneyField
        label="Opening balance"
        currency="EUR"
        defaultValue={186_000}
        onValueChange={setMinor}
      />
      <p className="text-sm text-muted-foreground" data-testid="minor">
        {minor === null ? "Nothing readable" : `${String(minor)} minor units`}
      </p>
    </div>
  );
}

/**
 * Changing the currency after typing re-reads the same text with the new currency's decimals:
 * type "100.00", switch to JPY, and the minor value becomes 100 (¥100), never 10000 (¥10,000).
 */
function ChangingCurrency() {
  const [currency, setCurrency] = useState("EUR");
  const [minor, setMinor] = useState<number | null>(null);

  return (
    <div className="flex max-w-xs flex-col gap-3">
      <Select
        label="Currency"
        items={[
          { value: "EUR", label: "EUR" },
          { value: "JPY", label: "JPY" },
          { value: "KWD", label: "KWD" },
        ]}
        value={currency}
        onValueChange={(value) => setCurrency(value ?? currency)}
      />
      <MoneyField
        label="Opening balance"
        currency={currency}
        defaultValue={10_000}
        onValueChange={setMinor}
      />
      <p className="text-sm text-muted-foreground" data-testid="minor">
        {minor === null ? "Nothing readable" : `${String(minor)} minor units`}
      </p>
    </div>
  );
}

/**
 * An amount typed as text, read back in integer minor units (docs/data-model.md, "Money"): no
 * currency symbol, the locale's separators, as many decimals as the currency takes. It reformats
 * to its canonical form only once it loses focus, so digits being typed never jump.
 *
 * Don't: reformat it on every keystroke (that fights typing), or use it where `Amount` (display
 * only) would do.
 */
const meta = {
  title: "Forms/MoneyField",
  component: MoneyField,
  args: { label: "Opening balance", currency: "EUR", defaultValue: 186_000 },
} satisfies Meta<typeof MoneyField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Reading /> };

export const ChangingCurrencyReparses: Story = { render: () => <ChangingCurrency /> };

export const Empty: Story = { args: { defaultValue: null } };

/** A currency with no decimals: the field never shows a fraction. */
export const NoDecimals: Story = { args: { label: "Amount", currency: "JPY", defaultValue: 3200 } };

export const WithError: Story = { args: { error: "This amount is not valid." } };

/** On a French page: the comma decimal and the narrow space as the thousands separator. */
export const French: Story = {
  render: (args) => (
    <InFrench>
      <MoneyField {...args} />
    </InFrench>
  ),
};
