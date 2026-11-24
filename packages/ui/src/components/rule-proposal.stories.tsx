import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { MAX_LABEL_TEXT } from "../stories/made-up-rules";
import { Button } from "./button";
import { RuleProposal } from "./rule-proposal";
import type { RuleProposalAnswer, RuleProposalSets } from "./rule-proposal";

type ProposingProps = RuleProposalSets & {
  words: string;
  reach: number | null;
  error?: string;
};

/** The proposal as the operations page opens it, after a correction; open at first. */
function Proposing(props: ProposingProps) {
  const [open, setOpen] = useState(true);
  const [opened, setOpened] = useState(0);
  const [answer, setAnswer] = useState<RuleProposalAnswer>();

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          setOpened(opened + 1);
          setOpen(true);
        }}
      >
        Correct a line
      </Button>
      <p data-testid="answer" className="text-sm text-muted-foreground">
        {answer === undefined ? "No rule made" : `Made: ${JSON.stringify(answer)}`}
      </p>
      <RuleProposal
        key={opened}
        open={open}
        {...props}
        onOpenChange={setOpen}
        maxLabelText={MAX_LABEL_TEXT}
        onCreate={async (made) => {
          setAnswer(made);
          setOpen(false);
        }}
      />
    </div>
  );
}

/**
 * A correction proposes a rule (#25): once a line's category is changed on the operations page,
 * "Make it a rule?" offers "label contains" the line's cleaned label, editable, for the category
 * chosen, and to apply it to the lines already there that it would change. "Not now" changes
 * nothing. Once a line paid through an intermediary is given its merchant (#30), it proposes the
 * same for that merchant (`merchant` in place of `category`).
 *
 * Motion: as `Dialog`, 200 ms in and out, ease-out. Cut under reduced motion.
 *
 * Don't: open it for a choice the user did not make (an import, a rule), or make the rule without
 * the user's answer.
 */
const meta = {
  title: "Rules/RuleProposal",
  component: Proposing,
  args: { category: "Food › Groceries", words: "GREENMARKET", reach: 12 },
} satisfies Meta<typeof Proposing>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * A line paid through PayPal was given its merchant by hand (#30): the rule sets that merchant for
 * the same label.
 */
export const Merchant: Story = {
  args: { category: undefined, merchant: "Pixelplay", words: "PAYPAL *PIXELPLAY", reach: 3 },
};

/** No other line looks like it yet: nothing to apply to the past. */
export const NoOtherLine: Story = { args: { reach: 0 } };

/** A label as long as banks write it. */
export const LongLabel: Story = {
  args: {
    words: "PRLV SEPA HARBOR SAVINGS MORTGAGE CONTRACT 00012345678 MONTHLY INSTALMENT",
    category: "Housing › Mortgage and home insurance repayments",
    reach: 1204,
  },
};

/** The server refused it. */
export const Refused: Story = {
  args: { error: "You have 200 rules already: delete one first." },
};

export const French: Story = {
  args: { category: "Alimentation › Courses" },
  render: (args) => (
    <InFrench>
      <Proposing {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
