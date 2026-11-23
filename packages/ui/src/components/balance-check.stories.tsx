import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { BalanceCheck, BalanceCheckSkeleton } from "./balance-check";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/**
 * The account page's balance check (docs/wireframes, screen 7, note 2): the app's balance against
 * the latest statement's; a mismatch shows the difference. With no statement yet, a plain
 * sentence.
 *
 * Loading: `BalanceCheckSkeleton`, at the same height.
 *
 * Motion: the result fades in (200 ms) once known. Cut under reduced motion.
 */
const meta = {
  title: "Accounts/BalanceCheck",
  component: BalanceCheck,
} satisfies Meta<typeof BalanceCheck>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Agrees: Story = {
  args: { state: "agrees", app: eur(186_000), statement: eur(186_000), day: "31 Oct." },
};

export const Disagrees: Story = {
  args: {
    state: "disagrees",
    app: eur(186_000),
    statement: eur(184_500),
    day: "31 Oct.",
    difference: eur(1500),
  },
};

/** The latest statement agrees, but an earlier one does not: shown below, not hidden. */
export const AgreesWithAnEarlierMismatch: Story = {
  args: {
    state: "agrees",
    app: eur(186_000),
    statement: eur(186_000),
    day: "31 Oct.",
    earlierMismatches: [
      { day: "30 Sep.", app: eur(172_000), statement: eur(170_500), difference: eur(1500) },
    ],
  },
};

export const NoStatement: Story = { args: { state: "no-statement" } };

export const Loading: Story = {
  args: { state: "agrees", app: eur(186_000), statement: eur(186_000), day: "31 Oct." },
  render: () => <BalanceCheckSkeleton />,
};

export const French: Story = {
  args: { state: "agrees", app: eur(186_000), statement: eur(186_000), day: "31 oct." },
  render: (args) => (
    <InFrench>
      <BalanceCheck {...args} />
    </InFrench>
  ),
};
