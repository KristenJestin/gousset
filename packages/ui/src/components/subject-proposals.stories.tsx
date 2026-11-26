import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { SubjectProposals, SubjectProposalsSkeleton } from "./subject-proposals";
import type { SubjectProposal } from "./subject-proposals";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** The made-up expenses of a trip's period, none attached yet. */
const PROPOSALS: ReadonlyArray<SubjectProposal> = [
  { id: "1", day: "3 Jul.", title: "Fuelstop", category: "Fuel", amount: eur(-6870) },
  { id: "2", day: "4 Jul.", title: "Alpine Lodge", category: "Travel", amount: eur(-42_000) },
  { id: "3", day: "6 Jul.", title: "Summit Café", category: "Restaurants", amount: eur(-3450) },
  { id: "4", day: "9 Jul.", title: "Greenmarket", category: "Groceries", amount: eur(-5210) },
];

/** The list as a page holds it: what was attached and declined is said under it. */
function Confirming({ more = 0, refuse = false }: { more?: number; refuse?: boolean }) {
  const [said, setSaid] = useState("Nothing yet");

  return (
    <div className="flex flex-col gap-3">
      <SubjectProposals
        label="Expenses to confirm for Alps 2028"
        proposals={PROPOSALS}
        more={more}
        onAttach={async (ids) => {
          setSaid(refuse ? "Refused: the rows come back" : `Attached: ${ids.join(", ")}`);

          return !refuse;
        }}
        onDecline={async (ids) => {
          setSaid(`Declined: ${ids.join(", ")}`);

          return true;
        }}
      />
      <p data-testid="said" className="text-sm text-muted-foreground">
        {said}
      </p>
    </div>
  );
}

/**
 * What a dated subject proposes (#37): the expenses of its period not attached yet, never attached
 * without the user's yes. Nothing is selected at first. Each row is attached (✓) or declined (✕,
 * "Not for this subject", remembered); a selection is attached or declined at once, or every row
 * with "Attach all". The count goes down as they go.
 *
 * Loading: `SubjectProposalsSkeleton`.
 *
 * Motion: a row attached or declined folds away, fading out in 200 ms while the rows under it
 * slide up; the count's digits roll; a row put back after a refusal fades in. Cut under reduced
 * motion.
 *
 * Don't: tick rows for the user, or attach an expense of the period on your own.
 */
const meta = {
  title: "Subjects/SubjectProposals",
  component: Confirming,
  args: { more: 0, refuse: false },
} satisfies Meta<typeof Confirming>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** More in the period than the list shows. */
export const WithMore: Story = { args: { more: 12 } };

/** The server refuses: the rows folded away come back. */
export const Refused: Story = { args: { refuse: true } };

/** Every expense of the period attached or declined. */
export const NothingLeft: Story = {
  render: () => (
    <SubjectProposals
      label="Expenses to confirm for Alps 2028"
      proposals={[]}
      onAttach={async () => true}
      onDecline={async () => true}
    />
  ),
};

export const Loading: Story = { render: () => <SubjectProposalsSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Confirming {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
