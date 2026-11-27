import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import {
  LONG_RULES,
  RULES,
  RULE_ACCOUNTS,
  RULE_MERCHANTS,
  SUBJECT_RULES,
  manyRules,
} from "../stories/made-up-rules";
import { InFrench } from "../stories/in-french";
import { RulesList, RulesListSkeleton } from "./rules-list";
import type { RulesListRow } from "./rules-list";

/** The list as a page holds it: a move puts the rule in its new place, which slides in. */
function Reordering({ rules }: { rules: ReadonlyArray<RulesListRow> }) {
  const [rows, setRows] = useState(rules);
  const [opened, setOpened] = useState<string>();
  const [turn, setTurn] = useState(0);

  const move = (id: string, place: number) => {
    const from = rows.findIndex((row) => row.id === id);
    const moved = rows[from];

    if (moved === undefined) {
      return;
    }

    const others = rows.filter((row) => row.id !== id).map((row) => ({ ...row, moved: undefined }));
    const at = Math.min(Math.max(place, 1), others.length + 1) - 1;
    const direction = at < from ? "up" : "down";

    setTurn(turn + 1);
    setRows([
      ...others.slice(0, at),
      { ...moved, moved: { direction, turn: turn + 1 } },
      ...others.slice(at),
    ]);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <RulesList
        label="Rules, in the order they are tried"
        rules={rows}
        accounts={RULE_ACCOUNTS}
        merchants={RULE_MERCHANTS}
        onOpen={setOpened}
        onMove={move}
        openId={opened}
      />
      <p data-testid="opened" className="text-sm text-muted-foreground">
        {opened === undefined ? "Nothing opened" : `Opened: ${opened}`}
      </p>
    </div>
  );
}

/**
 * The rules of the settings (docs/wireframes, screen 9, block 2): rules as sentences, "if…
 * then…", in the order they are tried (the first that applies wins), with how many lines each
 * classified. A rule turned off is faded and says "Off"; a rule whose category was archived says so
 * beside it. A rule that attaches a subject says it last, "for Van" (#37), and a merchant's
 * condition names the merchant. Pressing a rule opens it; its arrows move it one place up or down. On a phone, "then"
 * goes under the sentence.
 *
 * Loading: `RulesListSkeleton`, the same rows at the same heights.
 *
 * Motion: rows fade and slide up on first paint (200 ms, ease-out, staggered); a rule moved slides
 * in from where it was (200 ms). Cut under reduced motion.
 *
 * Don't: draw a rule as its JSON, or put its editor in the row: it opens in a side sheet
 * (`RuleEditor`). No rule at all is the page's `EmptyState`, not an empty list.
 */
const meta = {
  title: "Rules/RulesList",
  component: Reordering,
  args: { rules: RULES },
} satisfies Meta<typeof Reordering>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Many rules: the list grows with the page. */
export const Many: Story = { args: { rules: manyRules(24) } };

/** A rule turned off: kept in its place, faded, "Off". */
export const TurnedOff: Story = {
  args: {
    rules: RULES.map((rule) => (rule.id === "rule-pixelplay" ? { ...rule, enabled: false } : rule)),
  },
};

/** A rule whose category was archived since: it classifies nothing new, and says so. */
export const ArchivedCategory: Story = {
  args: {
    rules: RULES.map((rule) =>
      rule.id === "rule-loan" ? { ...rule, categoryArchived: true } : rule,
    ),
  },
};

/**
 * Rules that attach a subject: on a merchant alone, beside a category, and one whose subject was
 * archived since, which says so.
 */
export const Subjects: Story = { args: { rules: [...SUBJECT_RULES, ...RULES.slice(0, 2)] } };

/** Labels as long as banks write them, and a rule of six conditions: they wrap, never overflow. */
export const LongLabels: Story = { args: { rules: [...LONG_RULES, ...RULES] } };

export const Loading: Story = {
  render: () => (
    <div className="max-w-4xl">
      <RulesListSkeleton rows={5} />
    </div>
  ),
};

export const French: Story = {
  args: {
    rules: RULES.map((rule) => ({
      ...rule,
      category: rule.category?.replace("Food", "Alimentation") ?? null,
    })),
  },
  render: (args) => (
    <InFrench>
      <Reordering {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
