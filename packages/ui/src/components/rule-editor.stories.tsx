import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { RuleConditions as Conditions } from "../lib/rule-fields";
import {
  LOAN_CONDITIONS,
  MAX_CONDITIONS,
  MAX_LABEL_TEXT,
  RULE_ACCOUNTS,
  RULE_CATEGORIES,
  RULE_MERCHANTS,
  labelContains,
} from "../stories/made-up-rules";
import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { RuleEditor } from "./rule-editor";
import type {
  RuleApplyView,
  RuleConditionError,
  RuleDraft,
  RuleEditorCategory,
  RuleReachView,
} from "./rule-editor";

type EditingProps = {
  rule: { place: number; createdFrom: "correction" | "user"; createdAt: string } | null;
  conditions: Conditions | null;
  merchantId: string | null;
  category: RuleEditorCategory | null;
  enabled: boolean;
  reach: RuleReachView;
  apply?: RuleApplyView;
  error?: string;
  conditionError?: RuleConditionError;
};

/** The editor as a page holds it, open at first; "Apply to the past" ends with 12 lines changed. */
function Editing(props: EditingProps) {
  const [open, setOpen] = useState(true);
  const [opened, setOpened] = useState(0);
  const [saved, setSaved] = useState<RuleDraft>();
  const [apply, setApply] = useState<RuleApplyView>(props.apply ?? { state: "idle" });

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          setOpened(opened + 1);
          setOpen(true);
        }}
      >
        Open the rule
      </Button>
      <p data-testid="saved" className="text-sm text-muted-foreground">
        {saved === undefined ? "Not saved" : `Saved: ${JSON.stringify(saved)}`}
      </p>
      <RuleEditor
        key={opened}
        open={open}
        onOpenChange={setOpen}
        rule={props.rule}
        conditions={props.conditions}
        merchantId={props.merchantId}
        category={props.category}
        enabled={props.enabled}
        maxConditions={MAX_CONDITIONS}
        maxLabelText={MAX_LABEL_TEXT}
        accounts={RULE_ACCOUNTS}
        currency="EUR"
        merchants={RULE_MERCHANTS}
        categories={RULE_CATEGORIES}
        reach={props.reach}
        error={props.error}
        conditionError={props.conditionError}
        onSave={async (draft) => {
          setSaved(draft);
        }}
        onDelete={props.rule === null ? undefined : async () => setOpen(false)}
        apply={apply}
        onApply={async () => {
          setApply({ state: "running" });
          await new Promise((resolve) => {
            setTimeout(resolve, 800);
          });
          setApply({ state: "done", changed: 12 });
        }}
      />
    </div>
  );
}

const GROCERIES: RuleEditorCategory = {
  id: "groceries",
  name: "Food › Groceries",
  kind: "expense",
  archived: false,
};

/**
 * A rule in a side sheet (docs/wireframes, screen 9, blocks 3 and 4): "If" its conditions (each a
 * field, an operator and a value typed with the control its field takes, "+ Condition" up to ten),
 * "Then" the merchant and the category it sets (the kind follows the category), whether it is on,
 * and its "Effect" on the lines already there before saving: how many it applies to, and how many
 * of those were classified otherwise by hand, changed only when "Reclassify them too" is ticked. A
 * saved rule is applied to the past from here; a new one asks whether to apply it once made.
 *
 * Motion: the sheet slides in from the right in about 300 ms (from the bottom on a phone); a
 * condition added fades and slides in 150 ms; the lines changed fade in 200 ms. Cut under reduced
 * motion.
 *
 * Don't: save on each change (the effect is read before saving), or apply a draft to the past: a
 * rule is applied as it is saved.
 */
const meta = {
  title: "Rules/RuleEditor",
  component: Editing,
  args: {
    rule: { place: 1, createdFrom: "correction", createdAt: "2026-03-04T09:12:00.000Z" },
    conditions: labelContains("GREENMARKET"),
    merchantId: "greenmarket",
    category: GROCERIES,
    enabled: true,
    reach: { state: "known", lines: 128, toChange: 9, byHand: 3 },
  },
} satisfies Meta<typeof Editing>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A rule born from a correction, 3 of whose lines were classified otherwise by hand. */
export const Default: Story = {};

/** A new rule: one condition on the label to fill in, nothing known of its effect yet. */
export const New: Story = {
  args: {
    rule: null,
    conditions: null,
    merchantId: null,
    category: null,
    reach: { state: "incomplete" },
  },
};

/** A new rule whose effect is known: it offers to apply it once made. */
export const NewWithEffect: Story = {
  args: {
    rule: null,
    conditions: labelContains("CORNER BISTRO"),
    merchantId: null,
    category: { id: "restaurants", name: "Food › Restaurants", kind: "expense", archived: false },
    reach: { state: "known", lines: 14, toChange: 14, byHand: 0 },
  },
};

/** Conditions on the amount and the day: two values for "between". */
export const AmountAndDay: Story = {
  args: {
    rule: { place: 4, createdFrom: "user", createdAt: "2026-10-02T18:40:00.000Z" },
    conditions: LOAN_CONDITIONS,
    merchantId: "harbor-savings",
    category: { id: "housing", name: "Housing", kind: "expense", archived: false },
    reach: { state: "known", lines: 36, toChange: 0, byHand: 0 },
  },
};

/** The effect being read again after a change. */
export const ReadingEffect: Story = { args: { reach: { state: "loading" } } };

/** Applied to the past: the lines it changed. */
export const Applied: Story = { args: { apply: { state: "done", changed: 12 } } };

/** A rule turned off. */
export const TurnedOff: Story = { args: { enabled: false } };

/** Its category archived since: shown and named, never offered for another rule. */
export const ArchivedCategory: Story = {
  args: { category: { ...GROCERIES, name: "Food › Old groceries", archived: true } },
};

/** The server refused one condition. */
export const Refused: Story = {
  args: {
    conditions: LOAN_CONDITIONS,
    conditionError: {
      index: 1,
      message:
        "Condition 2 cannot be read: check its value, and that a range goes from the lowest to the highest.",
    },
  },
};

/** A label as long as banks write it. */
export const LongLabels: Story = {
  args: {
    conditions: labelContains(
      "PRLV SEPA HARBOR SAVINGS MORTGAGE CONTRACT 00012345678 MONTHLY INSTALMENT OCTOBER",
    ),
    merchantId: "harbor-savings",
    category: {
      id: "rent",
      name: "Housing › Mortgage and home insurance repayments",
      kind: "expense",
      archived: false,
    },
  },
};

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Editing {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
