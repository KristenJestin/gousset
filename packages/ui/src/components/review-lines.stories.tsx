import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { ReviewLines, ReviewLinesSkeleton } from "./review-lines";
import type { ReviewLine } from "./review-lines";
import { TextLink } from "./text-link";

const eur = (minor: number) => ({ minor, currency: "EUR" });

// Made-up lines the rules were not sure of.
const LINES: ReadonlyArray<ReviewLine> = [
  {
    id: "pixelplay",
    label: "PAYLINK *PIXELPLAY",
    title: "Pixelplay",
    tags: ["Leisure", "Current account"],
    amount: eur(-1499),
  },
  {
    id: "bistro",
    label: "CB CORNER BISTRO 14/10",
    title: "Corner Bistro",
    tags: ["Restaurants", "MealCard"],
    amount: eur(-2340),
  },
  {
    id: "unknown",
    label: "PRLV SEPA 88213 REF 4471",
    title: "PRLV SEPA 88213 REF 4471",
    tags: [],
    amount: eur(-4200),
  },
  {
    id: "fuel",
    label: "CB FUELSTOP 22/10",
    title: "Fuelstop",
    tags: ["Transport"],
    amount: eur(-6150),
  },
  {
    id: "market",
    label: "CB GREENMARKET",
    title: "Greenmarket",
    tags: ["Groceries"],
    amount: eur(-3812),
  },
];

/** The list with its approvals working: an approved line folds away. */
function Approving() {
  const [lines, setLines] = useState(LINES);
  const [all, setAll] = useState(false);

  return (
    <div className="max-w-2xl">
      <ReviewLines
        lines={lines}
        approveText="Approve"
        approveLabel={(line) => `Approve ${line.label}`}
        onApprove={(id) => setLines(lines.filter((line) => line.id !== id))}
        limit={all ? undefined : 3}
        onMore={() => setAll(true)}
        label="To review"
        locale="en"
      />
    </div>
  );
}

/**
 * The lines the rules were not sure of (screen 1, block 5): the bank's raw label, what the rules
 * made of it (merchant, category, account) and the action that approves it, its name read with the
 * line's label. Cut after `limit` lines; with `onMore`, a button "Show the other N".
 *
 * Without the approval's props, the lines are read only (the monthly review lists the first ones
 * and leads, with `footer`, to where they are reviewed).
 *
 * Loading: `ReviewLinesSkeleton`, as many lines as it shows and the last line, same heights;
 * `readOnly` leaves out the action's place.
 *
 * Motion: an approved line fades out (200 ms, ease-out) and the lines under it slide up into its
 * place, by transform; cut under reduced motion. The "Maybe a refund" chip has none of its own: it
 * comes and goes with its line.
 *
 * Don't: approve without the page's optimistic mutation, or name a button "More" (the frame's
 * menu is).
 */
const meta = {
  title: "Money/Review lines",
  component: ReviewLines,
  args: {
    lines: LINES,
    approveText: "Approve",
    approveLabel: (line) => `Approve ${line.label}`,
    onApprove: () => undefined,
    label: "To review",
  },
} satisfies Meta<typeof ReviewLines>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Three lines and "Show the other 2"; approving one folds it away. */
export const Default: Story = { render: () => <Approving /> };

/** Every line, nothing cut. */
export const All: Story = {};

export const Loading: Story = { render: () => <ReviewLinesSkeleton rows={3} more /> };

/** The first three lines, read only, and a link to where they are reviewed. */
export const ReadOnly: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ReviewLines
        lines={LINES.slice(0, 3)}
        label="To review"
        locale="en"
        footer={<TextLink href="#review">Review the month&rsquo;s lines</TextLink>}
      />
    </div>
  ),
};

/** A line coming back that may cancel a purchase (#208): flagged, no category as its title. */
const MAYBE_REFUND: ReviewLine = {
  id: "pixelplay-back",
  label: "CARD PIXELPLAY STORE",
  title: "CARD PIXELPLAY STORE",
  tags: ["Current account", "Oct 4"],
  amount: eur(3000),
  maybeRefund: true,
};

/** The review's first lines, read only, one of them maybe a refund (#208). */
export const MaybeRefund: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ReviewLines
        lines={[MAYBE_REFUND, ...LINES.slice(0, 2)]}
        label="To review"
        locale="en"
        footer={<TextLink href="#review">Review the month&rsquo;s lines</TextLink>}
      />
    </div>
  ),
};

export const MaybeRefundFrench: Story = {
  render: () => (
    <InFrench>
      <div className="max-w-2xl">
        <ReviewLines
          lines={[{ ...MAYBE_REFUND, tags: ["Compte courant", "4 oct."] }, ...LINES.slice(0, 2)]}
          label="À vérifier"
          locale="fr"
        />
      </div>
    </InFrench>
  ),
};

/** `ReadOnly` on its way: no action's place. */
export const ReadOnlyLoading: Story = {
  render: () => (
    <div className="max-w-2xl">
      <ReviewLinesSkeleton rows={3} more readOnly />
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Approving />,
};
