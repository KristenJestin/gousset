import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import type { CategoryChoice } from "./category-picker";
import { LineDetail } from "./line-detail";
import { ReviewProposal } from "./review-proposal";
import type { ReviewProposalKind } from "./review-proposal";

const EXPENSES: ReadonlyArray<CategoryChoice> = [
  {
    id: "groceries",
    name: "Groceries",
    children: [
      { id: "supermarket", name: "Supermarket" },
      { id: "bakery", name: "Bakery" },
    ],
  },
  { id: "leisure", name: "Leisure", children: [{ id: "streaming", name: "Streaming" }] },
  { id: "other", name: "Other" },
];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type ReviewingProps = {
  kind: ReviewProposalKind;
  proposal: string;
  label: string;
  acceptable?: boolean;
  category: string | null;
  /** The server refuses every correction, with these words. */
  refusal?: string;
  /** What the page says under the buttons. */
  notice?: string;
};

/**
 * The proposal as the operations page holds it, at most 360 px wide (a phone's sheet): accepting or
 * correcting takes half a second, long enough to see the button busy, then what was done is
 * written under it.
 */
function Reviewing({ refusal, notice, ...props }: ReviewingProps) {
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState<"accept" | "correct">();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState("Nothing done");

  const accept = async () => {
    setBusy("accept");
    await wait(500);
    setBusy(undefined);
    setDone("Accepted");
  };

  const correct = async (categoryId: string | null) => {
    setBusy("correct");
    await wait(500);
    setBusy(undefined);

    if (refusal !== undefined) {
      setError(refusal);

      return;
    }

    setError(undefined);
    setCorrecting(false);
    setDone(categoryId === null ? "Kept" : `Corrected: ${categoryId}`);
  };

  return (
    <div className="flex w-90 max-w-full flex-col gap-3">
      <ReviewProposal
        {...props}
        onAccept={() => void accept()}
        accepting={busy === "accept"}
        onCorrect={(categoryId) => void correct(categoryId)}
        correctingSent={busy === "correct"}
        correcting={correcting}
        onCorrectingChange={setCorrecting}
        categories={EXPENSES}
        error={error}
        notice={notice}
      />
      <p data-testid="done" className="text-xs text-muted-foreground">
        {done}
      </p>
    </div>
  );
}

/**
 * What Gousset proposes for a line to review (#35), at the top of its detail in the operations'
 * review mode ("To review only"): the proposal in one sentence, worded by the page, Accept, and
 * Correct, which opens a dialog to choose the category the line goes in. For a held repeat,
 * Correct is "Keep it", with no dialog. The buttons' names say the action and the line. A refusal
 * of the correction stays in the dialog, under its field; what the page says of an accept (a
 * proposal changed meanwhile) shows under the buttons.
 *
 * Keyboard, on the page: A accepts, C corrects (or keeps a repeat), J and K go to the next and the
 * previous line; each is also a button reached by Tab.
 *
 * Motion: none of its own. The dialog is `Dialog`'s, 200 ms in and out, ease-out (on a phone it
 * rises from the bottom edge in 300 ms); the line accepted folds away from the list in 200 ms. Cut
 * under reduced motion.
 *
 * Don't: accept or correct without the user's press or key, or open it outside the review mode:
 * a line that is not to review has nothing to propose.
 */
const meta = {
  title: "Operations/ReviewProposal",
  component: Reviewing,
  args: {
    kind: "category",
    proposal: "Keep it in Groceries › Supermarket (Greenmarket).",
    label: "CB GREENMARKET 2110 RIVERTON",
    category: "supermarket",
  },
} satisfies Meta<typeof Reviewing>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A line Gousset classified by default: keep it in its category, or correct it. */
export const Category: Story = {};

/** A line held as a near duplicate: discard it, or keep it, with no dialog. */
export const Duplicate: Story = {
  args: {
    kind: "duplicate",
    proposal: "Discard it: it repeats the line of Oct. 21, CB GREENMARKET 2110 RIVERTON, −€52.00.",
    label: "GREENMARKET RIVERTON",
    category: null,
  },
};

/** A transfer with several possible other sides: the nearest is proposed, the others below. */
export const Transfer: Story = {
  args: {
    kind: "transfer",
    proposal:
      "Pair it as a transfer with the line of Oct. 16 on Savings pot, +€70.00. 1 other is shown below.",
    label: "SEPA TRF TO SAVINGS",
    category: "other",
  },
};

/** Money coming back: linked as a refund of the likeliest expense. */
export const Refund: Story = {
  args: {
    kind: "refund",
    proposal:
      "Link it as a refund of the expense of Oct. 9, CB HARBOR SHOES: Clothing, costing €89.00.",
    label: "REFUND HARBOR SHOES",
    category: "other",
  },
};

/** A line with no category to keep: Correct alone. */
export const NothingToAccept: Story = {
  args: { proposal: "Choose the category it goes in.", acceptable: false, category: null },
};

/** The server refuses the correction: the reason under the field, the dialog still open. */
export const Refused: Story = {
  args: { refusal: "That category is archived: choose one in use." },
};

/** The proposal changed meanwhile: the page shows the new one and says so. */
export const Changed: Story = {
  args: { notice: "Its proposal changed meanwhile: here is the new one." },
};

/** A long label, as banks write it, and a long category path. */
export const LongWords: Story = {
  args: {
    proposal:
      "Keep it in Housing › Mortgage and home insurance repayments (Harbor Savings Mortgage Services).",
    label: "PRLV SEPA HARBOR SAVINGS MORTGAGE CONTRACT 00012345678 MONTHLY INSTALMENT",
  },
};

/** At the top of the line's detail, in its sheet, where the operations page shows it. */
export const InDetail: Story = {
  render: (args) => (
    <LineDetail
      label={args.label}
      amount={{ minor: -5200, currency: "EUR" }}
      account="Current account"
      bookedOn="21 October 2026"
      rawLabel="CB GREENMARKET 2110 RIVERTON CARTE 4971"
      review={<Reviewing {...args} />}
      onClose={() => undefined}
    />
  ),
};

export const French: Story = {
  args: { proposal: "La garder dans Courses › Supermarché (Greenmarket)." },
  render: (args) => (
    <InFrench>
      <div className="flex flex-col gap-6">
        <Reviewing {...args} />
        <Reviewing
          {...args}
          kind="duplicate"
          proposal="L'écarter : elle répète la ligne du 21 oct., CB GREENMARKET, −52,00 €."
        />
      </div>
    </InFrench>
  ),
};

/** On a phone, in the detail's sheet; the dialog is a bottom sheet. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
