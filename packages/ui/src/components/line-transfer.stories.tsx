import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { LineTransfer, LineTransferCandidates, LineTransferToAccount } from "./line-transfer";

const eur = (minor: number) => ({ minor, currency: "EUR" });

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Pairs after a second, long enough to see the button busy. */
async function pairLater() {
  await wait(1000);

  return true;
}

/** The column the page gives the detail: 340 px beside the list. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex w-85 max-w-full flex-col">{children}</div>;
}

const livretA = {
  id: "line-livret-a",
  day: "Oct 10",
  label: "SEPA TRF TO LIVRET A",
  account: "Livret A",
  amount: eur(25_000),
};

const savingsPot = {
  id: "line-savings-pot",
  day: "Oct 11",
  label: "SEPA TRF RECEIVED",
  account: "Savings pot",
  amount: eur(25_000),
};

/**
 * A line's transfer, in its detail (`LineDetail`'s `transfer`): "Transfer to <account>" or "from",
 * "Set aside" when the money went to savings or investments, and the other side as one button that
 * opens its detail; "Made by Gousset: …" when the app made that side, which its own statement does
 * not show. "Not a transfer" asks first, then unpairs. A line that may be a transfer shows
 * `LineTransferCandidates`: its candidates under "Maybe a transfer", and "Pair as a transfer",
 * which opens a dialog to choose one. A line whose other side may be on an account kept by its
 * balance shows `LineTransferToAccount`: "Pair with an account" opens a dialog to choose that
 * account, whose side Gousset makes. Every value comes worded from the page.
 *
 * Motion: none of its own: the dialogs are `Dialog`'s and `AlertDialog`'s (200 ms), and going to
 * the other side is the detail's own close and open. Cut under reduced motion.
 *
 * Don't: show either for a line that is no transfer and has no candidate (leave it out), or pair
 * without the dialog: the user chooses the other side.
 */
const meta = {
  title: "Operations/LineTransfer",
  component: LineTransfer,
  args: {
    direction: "out",
    other: livretA,
    setAside: true,
    onOpenOther: () => undefined,
    onUnpair: () => wait(1000),
  },
  render: (args) => (
    <Column>
      <LineTransfer {...args} />
    </Column>
  ),
} satisfies Meta<typeof LineTransfer>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Money out to a savings account: set aside, the other side one click away. */
export const TransferOut: Story = {};

/** The side that came in: "Transfer from". */
export const TransferIn: Story = {
  args: {
    direction: "in",
    other: { ...livretA, id: "line-current", account: "Current account", amount: eur(-25_000) },
  },
};

/** A deferred card's monthly debit: the card's side was made by the app. */
export const MadeByGousset: Story = {
  args: {
    other: {
      id: "line-card",
      day: "Nov 5",
      label: "DEFERRED CARD DEBIT",
      account: "Deferred card",
      amount: eur(41_230),
    },
    setAside: false,
    madeOn: "Deferred card",
  },
};

/** The last unpairing was refused: the reason under the action. */
export const UnpairRefused: Story = {
  args: { error: "This line is no longer a transfer." },
};

/** Two lines may be its other side: the user chooses one in the dialog. */
export const Candidates: Story = {
  render: () => (
    <Column>
      <LineTransferCandidates candidates={[livretA, savingsPot]} onPair={pairLater} />
    </Column>
  ),
};

/** One candidate, which the dialog shows alone, checked. */
export const OneCandidate: Story = {
  render: () => (
    <Column>
      <LineTransferCandidates candidates={[livretA]} onPair={pairLater} />
    </Column>
  ),
};

const balanceAccounts = [
  { id: "account-perkshub", name: "PerksHub" },
  { id: "account-mealcard", name: "MealCard" },
];

/** Its other side may be on an account kept by its balance: the user chooses it in the dialog. */
export const ToAccount: Story = {
  render: () => (
    <Column>
      <LineTransferToAccount accounts={balanceAccounts} onPair={pairLater} />
    </Column>
  ),
};

/** Candidates and accounts kept by their balance alike: the candidates first. */
export const CandidatesAndAccount: Story = {
  render: () => (
    <Column>
      <LineTransferCandidates candidates={[livretA]} onPair={pairLater} />
      <LineTransferToAccount accounts={balanceAccounts} onPair={pairLater} />
    </Column>
  ),
};

export const French: Story = {
  args: { other: { ...livretA, day: "10 oct." }, madeOn: "Livret A" },
  render: (args) => (
    <InFrench>
      <Column>
        <LineTransfer {...args} />
        <LineTransferCandidates
          candidates={[
            { ...livretA, day: "10 oct." },
            { ...savingsPot, day: "11 oct." },
          ]}
          onPair={pairLater}
        />
        <LineTransferToAccount accounts={balanceAccounts} onPair={pairLater} />
      </Column>
    </InFrench>
  ),
};

/** On a phone, in the detail that takes the screen's width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
