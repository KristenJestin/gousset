import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import {
  PaybackCandidates,
  PaybackStateChip,
  SubjectPayback,
  SubjectPaybackSkeleton,
} from "./subject-payback";
import type { PaybackLineView, PaybackStateName } from "./subject-payback";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** The made-up expense report that pays a work trip back. */
const REPORT: PaybackLineView = {
  id: "report",
  day: "20 Oct.",
  label: "VIR NORTHWIND CONSULTING NOTE DE FRAIS",
  account: "Everyday account",
  amount: eur(91_450),
};

/** Lines that came in, which may pay it back: the payer's first. */
const CANDIDATES: ReadonlyArray<PaybackLineView> = [
  REPORT,
  {
    id: "friend",
    day: "16 Oct.",
    label: "VIR SAM EXAMPLE",
    account: "Everyday account",
    amount: eur(2500),
  },
  {
    id: "refund",
    day: "2 Oct.",
    label: "VIR EXAMPLE INSURANCE CLAIM",
    account: "Savings book",
    amount: eur(9000),
  },
];

/**
 * The block as a page holds it: a line detached leaves the figures; attached from the sheet, it
 * comes into them. `refuse`: the server says no, the line comes back.
 */
function Paying({ refuse = false, attached = true }: { refuse?: boolean; attached?: boolean }) {
  const [lines, setLines] = useState<ReadonlyArray<PaybackLineView>>(attached ? [REPORT] : []);
  const [error, setError] = useState<string>();
  const spent = 25_185;
  const paidBack = lines.reduce((sum, line) => sum + line.amount.minor, 0);

  const state: PaybackStateName =
    paidBack >= spent ? "paid_back" : paidBack > 0 ? "partly" : "to_ask";

  return (
    <SubjectPayback
      from="Northwind Consulting"
      state={state}
      spent={eur(spent)}
      paidBack={eur(paidBack)}
      difference={eur(paidBack - spent)}
      lines={lines}
      onDetach={async (id) => {
        if (refuse) {
          return false;
        }

        setLines(lines.filter((line) => line.id !== id));

        return true;
      }}
      find={
        <PaybackCandidates
          from="Northwind Consulting"
          candidates={CANDIDATES.filter((each) => !lines.some((line) => line.id === each.id))}
          error={error}
          onAttach={async (id) => {
            if (refuse) {
              setError(
                "This line already pays back another subject: detach it from that one first.",
              );

              return false;
            }

            const line = CANDIDATES.find((each) => each.id === id);

            setLines(line === undefined ? lines : [...lines, line]);

            return true;
          }}
        />
      }
    />
  );
}

/**
 * A subject paid back by someone else (#217): who pays it back and where it stands, what it cost
 * ("spent", all time), what came back ("paid back") and the difference, signed either way, then
 * the lines that pay it back, each to detach (✕). "Find payback lines" opens a side sheet of the
 * lines that came in and may pay it back, the payer's first; none is attached until the user
 * presses its "Attach".
 *
 * Loading: `SubjectPaybackSkeleton`.
 *
 * Motion: a line detached or attached folds away, fading out in 200 ms while the rows under it
 * slide up; the amounts roll to their new values in 200 ms; the sheet slides in in 300 ms and out
 * in 200 ms. Cut under reduced motion.
 *
 * Don't: attach a line the user did not choose, or count what came back as income.
 */
const meta = {
  title: "Subjects/SubjectPayback",
  component: Paying,
  args: { refuse: false, attached: true },
} satisfies Meta<typeof Paying>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The work trip: 251.85 spent, 914.50 paid back, +662.65. */
export const Default: Story = {};

/** Nothing came back yet: to ask. */
export const ToAsk: Story = { args: { attached: false } };

/** A shared holiday, two transfers that cover less than it cost. */
export const Partly: Story = {
  render: () => (
    <SubjectPayback
      from="Sam Example"
      state="partly"
      spent={eur(78_000)}
      paidBack={eur(35_000)}
      difference={eur(-43_000)}
      lines={[
        {
          id: "cabin",
          day: "20 Aug.",
          label: "VIR SAM EXAMPLE CABIN",
          account: "Everyday account",
          amount: eur(20_000),
        },
        {
          id: "canoe",
          day: "2 Sept.",
          label: "VIR SAM EXAMPLE CANOE",
          account: "Everyday account",
          amount: eur(15_000),
        },
      ]}
      onDetach={async () => true}
    />
  ),
};

/** The server refuses: the line detached comes back, a refusal is said in the sheet. */
export const Refused: Story = { args: { refuse: true } };

/** Every state, as a pill: the user's to do in violet, paid back with its green mark. */
export const States: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <PaybackStateChip state="to_ask" />
      <PaybackStateChip state="asked" askedOn="4 May" />
      <PaybackStateChip state="asked" />
      <PaybackStateChip state="partly" />
      <PaybackStateChip state="paid_back" />
    </div>
  ),
};

export const Loading: Story = { render: () => <SubjectPaybackSkeleton rows={2} /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Paying {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
