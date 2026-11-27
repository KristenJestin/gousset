import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { RuleConditions, RuleConditionsDraft } from "../lib/rule-fields";
import { InFrench } from "../stories/in-french";
import {
  LOAN_CONDITIONS,
  MAX_CONDITIONS,
  MAX_LABEL_TEXT,
  RULE_ACCOUNTS,
  RULE_MERCHANTS,
  labelContains,
  merchantIs,
} from "../stories/made-up-rules";
import { RuleConditionsEditor } from "./rule-conditions";

/** The conditions as an editor holds them, with what they read as now. */
function Editing({ initial, disabled }: { initial: RuleConditions | null; disabled?: boolean }) {
  const [conditions, setConditions] = useState<RuleConditionsDraft | RuleConditions | null>(
    initial,
  );

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <RuleConditionsEditor
        initial={initial}
        onChange={setConditions}
        accounts={RULE_ACCOUNTS}
        merchants={RULE_MERCHANTS}
        currency="EUR"
        maxConditions={MAX_CONDITIONS}
        maxLabelText={MAX_LABEL_TEXT}
        disabled={disabled}
      />
      <pre data-testid="conditions" className="text-xs whitespace-pre-wrap text-muted-foreground">
        {conditions === null ? "New" : JSON.stringify(conditions)}
      </pre>
    </div>
  );
}

/**
 * A rule's conditions, edited on qnot's headless hooks (`@qnot/react`) with packages/ui's controls:
 * one row each, its field (label, merchant, account, amount, direction, day of the month, date),
 * its operator and its value, typed with the control its field takes (two for "between"; a merchant
 * found by typing its name). "+ Condition" adds
 * one, up to ten; ✕ removes one. All of them are to be met. The page gets each change as qnot holds
 * it, and reads it with the server's own checks.
 *
 * Motion: a condition added fades and slides in 150 ms, ease-out. Cut under reduced motion.
 *
 * Don't: nest groups or offer "or": the rules are one flat group, every condition to be met.
 */
const meta = {
  title: "Rules/RuleConditionsEditor",
  component: Editing,
  args: { initial: labelContains("GREENMARKET") },
} satisfies Meta<typeof Editing>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A new rule: one condition on the label, to fill in. */
export const Empty: Story = { args: { initial: null } };

/** A merchant's condition: the line's merchant, found by typing its name. */
export const Merchant: Story = { args: { initial: merchantIs("fuelstop") } };

/** An amount and a day of the month between two values. */
export const AmountAndDay: Story = { args: { initial: LOAN_CONDITIONS } };

/** Every field once. */
export const EveryField: Story = {
  args: {
    initial: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "startsWith", value: "CB FUELSTOP" },
        { kind: "rule", field: "merchant", operator: "eq", value: "fuelstop" },
        { kind: "rule", field: "account", operator: "eq", value: RULE_ACCOUNTS[0].id },
        { kind: "rule", field: "amount", operator: "gte", value: 40 },
        { kind: "rule", field: "direction", operator: "eq", value: "out" },
        { kind: "rule", field: "day", operator: "lte", value: 10 },
        { kind: "rule", field: "date", operator: "gte", value: "2026-01-01" },
      ],
    },
  },
};

export const Disabled: Story = { args: { disabled: true } };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Editing {...args} />
    </InFrench>
  ),
};
