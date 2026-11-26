import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { LineFundedBy, LineFunds } from "./line-funding";
import type { FundedExpenseView } from "./line-funding";

// Every label, account and amount here is invented: PerksHub, a works council's benefit account,
// refunds 80.00 of a sports club's 120.00 fee.

const eur = (minor: number) => ({ minor, currency: "EUR" });

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Funds after a second, long enough to see the button busy. */
async function fundLater() {
  await wait(1000);

  return true;
}

/** A narrow column, 340 px: about what the detail's sheet gives its blocks on a phone. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex w-85 max-w-full flex-col">{children}</div>;
}

const sportsClub: FundedExpenseView = {
  id: "line-sports-club",
  day: "Oct 2",
  category: "Leisure › Sport",
  label: "CB RIVERSIDE SPORTS CLUB 0210",
  net: eur(12_000),
};

const summerCamp: FundedExpenseView = {
  id: "line-summer-camp",
  day: "Aug 28",
  category: "Children › Holidays",
  label: "PRLV HARBOR SUMMER CAMP",
  net: eur(35_000),
};

/**
 * A works council refund, in a side's detail: a transfer from a benefit account to the bank may
 * fund one of the user's expenses, which keeps its cost. Funding none, "Fund an expense" opens a
 * dialog of the expenses offered (of its currency, of the 90 days before it, costing at least it),
 * the nearest checked. Funding one, the expense is one click from its line, and "Unfund" stops it.
 * `LineFundedBy` is the other side of the link: on the expense's detail, the transfers funding it.
 *
 * Motion: none of its own: the dialog is `Dialog`'s (fades and grows in 200 ms, rises in 300 ms on
 * a phone), a row's hover colour 150 ms. Cut under reduced motion.
 *
 * Don't: fund an expense unasked: the user says which expense a refund pays back.
 */
const meta = {
  title: "Operations/LineFunding",
  component: LineFunds,
  args: {
    candidates: [sportsClub, summerCamp],
    onOpenExpense: () => undefined,
    onFund: fundLater,
    onUnfund: () => wait(1000),
  },
  render: (args) => (
    <Column>
      <LineFunds {...args} />
    </Column>
  ),
} satisfies Meta<typeof LineFunds>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A refund funding no expense yet: two expenses it may fund. */
export const Candidates: Story = {};

/** A refund that funds the sports club's fee. */
export const Funds: Story = {
  args: { funds: sportsClub, candidates: [] },
};

/** No expense of the 90 days before it costs at least this refund. */
export const NoCandidate: Story = {
  args: { candidates: [] },
};

/** The last change was refused: the reason under the block. */
export const Refused: Story = {
  args: { error: "This refund is more than that expense still costs, its other refunds counted." },
};

/** The expense's side: the refund that funds it, what is funded in all, its cost kept. */
export const FundedBy: Story = {
  render: () => (
    <Column>
      <LineFundedBy
        fundings={[
          {
            id: "line-perkshub-refund",
            day: "Oct 19",
            label: "PERKSHUB REFUND 0042",
            account: "PerksHub",
            amount: eur(8000),
          },
        ]}
        funded={eur(8000)}
        net={eur(12_000)}
        onOpenLine={() => undefined}
      />
    </Column>
  ),
};

export const French: Story = {
  args: { funds: { ...sportsClub, day: "2 oct.", category: "Loisirs › Sport" }, candidates: [] },
  render: (args) => (
    <InFrench>
      <Column>
        <LineFunds {...args} />
        <LineFundedBy
          fundings={[
            {
              id: "line-perkshub-refund",
              day: "19 oct.",
              label: "PERKSHUB REFUND 0042",
              account: "PerksHub",
              amount: eur(8000),
            },
          ]}
          funded={eur(8000)}
          net={eur(12_000)}
          onOpenLine={() => undefined}
        />
      </Column>
    </InFrench>
  ),
};

/** On a phone, in the detail that takes the screen's width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
