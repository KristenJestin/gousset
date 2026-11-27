import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { LineExpense, LinkLine, SplitLine } from "./line-expense";
import type { ExpenseLineView, LineExpenseProps } from "./line-expense";

// Every label, account and amount here is invented.

const eur = (minor: number) => ({ minor, currency: "EUR" });

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Saves after a second, long enough to see the button busy. */
async function saveLater() {
  await wait(1000);

  return true;
}

/** A narrow column, 340 px: about what the detail's sheet gives its blocks on a phone. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex w-85 max-w-full flex-col">{children}</div>;
}

const onCurrent: ExpenseLineView = {
  id: "line-current",
  day: "Oct 12",
  label: "CB HARBOR HOME 1210 RIVERTON",
  account: "Current account",
  amount: eur(2500),
};

const onCard: ExpenseLineView = {
  id: "line-card",
  day: "Oct 12",
  label: "CB HARBOR HOME 1210 RIVERTON",
  account: "Travel card",
  amount: eur(5000),
};

const share: ExpenseLineView = {
  id: "line-share",
  day: "Oct 20",
  label: "VIR SEPA RECU /DE SAM EXAMPLE /MOTIF HOME",
  account: "Current account",
  amount: eur(2000),
};

const bistro: ExpenseLineView = {
  id: "line-bistro",
  day: "Oct 3",
  label: "CB CORNER BISTRO 0310 RIVERTON",
  account: "Current account",
  amount: eur(5600),
};

const categories = [
  {
    id: "groceries",
    name: "Groceries",
    children: [{ id: "supermarket", name: "Supermarket" }],
  },
  { id: "shopping", name: "Shopping", children: [{ id: "home", name: "Home and garden" }] },
  { id: "other", name: "Other" },
];

/** The link dialog, its search answered from a few lines. */
function Link() {
  const lines = [onCurrent, onCard, bistro];
  const [search, setSearch] = useState("");

  const found = lines.filter((line) =>
    line.label.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <LinkLine candidates={found} search={search} onSearchChange={setSearch} onLink={saveLater} />
  );
}

const split = (
  <SplitLine
    total={eur(9000)}
    categories={categories}
    initial={[{ categoryId: "groceries", minor: 9000 }]}
    max={20}
    onSplit={saveLater}
  />
);

/** The user's subjects in use, by their paths (#37). */
const subjects = [
  { id: "house", name: "House" },
  { id: "shed", name: "House > Garden shed" },
  { id: "van", name: "Van" },
  { id: "alps", name: "Alps 2026" },
];

const van = { id: "van", name: "Van" };

/** An expense's split, each share with its subjects: the line's to start with. */
const splitBySubject = (
  <SplitLine
    total={eur(8000)}
    categories={categories}
    initial={[
      { categoryId: "other", minor: 5000, subjects: [van] },
      { categoryId: "other", minor: 3000, subjects: [{ id: "alps", name: "Alps 2026" }] },
    ]}
    max={20}
    subjects={subjects}
    lineSubjects={[van]}
    onSplit={saveLater}
  />
);

/**
 * A line answered "Not a refund" after a second: the page reads it again, with no proposal, and
 * "Maybe a refund" goes at once.
 */
function Refusable(props: LineExpenseProps) {
  const [refused, setRefused] = useState(false);

  return (
    <LineExpense
      {...props}
      proposals={refused ? [] : props.proposals}
      maybeRefund={!refused && props.maybeRefund === true}
      onRefuseRefund={async () => {
        await wait(1000);
        setRefused(true);
      }}
    />
  );
}

/**
 * A line's expense, in its detail (`LineDetail`'s `expense`): an expense made of several lines,
 * its payments and refunds one click from their lines, and its net cost counted once; "Separate
 * this line" asks before taking the line out. A split line shows its shares; a line coming back
 * that may cancel a purchase shows "Maybe a refund", which asks before linking; still classified
 * by default, it counts as no income until answered, and "Not a refund" answers at once (#208): the
 * money stays an income, and linking the line by hand still makes it a refund. Under it, the page
 * puts `LinkLine` ("Link to an expense", a dialog to find the expense's line) and `SplitLine`
 * ("Split", a side sheet of shares that must make the whole line; an expense's shares each with
 * their subjects, #37, how an expense is shared between subjects). Every value comes worded.
 *
 * Motion: none of its own: the dialogs are `Dialog`'s and `AlertDialog`'s (200 ms), the sheet
 * `Sheet`'s (about 300 ms), a part's hover colour 150 ms, a share's subject chip fades in and out
 * in 150 ms, "Not a refund" is `Button`'s (its colour in 150 ms, pressed in and back). Cut under
 * reduced motion. Answered, "Maybe a refund" goes at once, with no fade nor fold, under any
 * setting.
 *
 * Don't: link a refund unasked, nor split without the sheet: the user decides what an expense is.
 */
const meta = {
  title: "Operations/LineExpense",
  component: LineExpense,
  args: {
    lineId: onCurrent.id,
    expense: {
      kind: "expense",
      payments: [onCurrent, onCard],
      refunds: [share],
      net: eur(5500),
    },
    onOpenLine: () => undefined,
    onUnlink: () => wait(1000),
    actions: (
      <>
        <Link />
        {split}
      </>
    ),
  },
  render: (args) => (
    <Column>
      <LineExpense {...args} />
    </Column>
  ),
} satisfies Meta<typeof LineExpense>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A 75 expense paid 25 + 50 on two accounts, a friend's 20 back: it costs 55, once. */
export const Linked: Story = {};

/** A line split across two categories. */
export const Split: Story = {
  args: {
    lineId: "line-stores",
    expense: undefined,
    onUnlink: undefined,
    shares: [
      { id: "share-groceries", category: "Groceries", amount: eur(3000) },
      { id: "share-home", category: "Shopping › Home and garden", amount: eur(6000) },
    ],
  },
};

/** An expense split between the van and the trip: each share with its subject's chip (#37). */
export const SplitBySubject: Story = {
  args: {
    lineId: "line-fuel",
    expense: undefined,
    onUnlink: undefined,
    shares: [
      { id: "share-van", category: "Other", amount: eur(5000), subjects: [van] },
      {
        id: "share-alps",
        category: "Other",
        amount: eur(3000),
        subjects: [{ id: "alps", name: "Alps 2026" }],
      },
    ],
    actions: splitBySubject,
  },
};

/**
 * The split's sheet of an expense: each share's subjects, a hint that splitting is how an expense
 * is shared between subjects, and a refusal about the second share said under it.
 */
export const SplitSheetBySubject: Story = {
  args: { expense: undefined, onUnlink: undefined },
  render: () => (
    <Column>
      <SplitLine
        total={eur(8000)}
        categories={categories}
        initial={[
          { categoryId: "other", minor: 5000, subjects: [van] },
          { categoryId: "other", minor: 3000, subjects: [{ id: "alps", name: "Alps 2026" }] },
        ]}
        max={20}
        subjects={subjects}
        lineSubjects={[van]}
        onSplit={saveLater}
        shareError={{
          index: 1,
          message: "An archived subject takes no more expenses: remove it from this share.",
        }}
      />
    </Column>
  ),
};

/** A purchase cancelled: the line coming back is proposed as its refund, for the user to confirm. */
export const Proposed: Story = {
  args: {
    lineId: "line-cancelled",
    expense: undefined,
    onUnlink: undefined,
    proposals: [{ ...bistro, category: "Eating out › Restaurants", net: eur(5600) }],
    onConfirmRefund: () => wait(1000),
  },
};

/**
 * Maybe a refund (#208): the line coming back, still classified by default, counts as no income
 * until the user answers. "Link as a refund" asks; "Not a refund" answers at once, and the section
 * goes.
 */
export const MaybeRefund: Story = {
  args: {
    lineId: "line-cancelled",
    expense: undefined,
    onUnlink: undefined,
    proposals: [{ ...bistro, category: "Eating out › Restaurants", net: eur(5600) }],
    maybeRefund: true,
    onConfirmRefund: () => wait(1000),
  },
  render: (args) => (
    <Column>
      <Refusable {...args} />
    </Column>
  ),
};

export const MaybeRefundFrench: Story = {
  args: {
    ...MaybeRefund.args,
    proposals: [{ ...bistro, day: "3 oct.", category: "Sorties › Restaurants", net: eur(5600) }],
  },
  render: (args) => (
    <InFrench>
      <Column>
        <Refusable {...args} />
      </Column>
    </InFrench>
  ),
};

/** The last change was refused: the reason under the actions. */
export const Refused: Story = {
  args: { error: "This refund is more than the expense still costs." },
};

/** The split's sheet, open from its button. */
export const SplitSheet: Story = {
  args: { expense: undefined, onUnlink: undefined },
  render: () => <Column>{split}</Column>,
};

export const French: Story = {
  args: {
    proposals: [{ ...bistro, day: "3 oct.", category: "Sorties › Restaurants", net: eur(5600) }],
    onConfirmRefund: () => wait(1000),
    shares: [{ id: "share-courses", category: "Courses", amount: eur(3000) }],
  },
  render: (args) => (
    <InFrench>
      <Column>
        <LineExpense {...args} />
      </Column>
    </InFrench>
  ),
};

/** On a phone, in the detail that takes the screen's width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
