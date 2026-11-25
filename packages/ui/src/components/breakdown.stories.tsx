import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { InFrench } from "../stories/in-french";
import {
  CATEGORIES,
  DAILY_SPENDING,
  MADE_UP_LOGO,
  MERCHANTS,
  PREVIOUS_CATEGORIES,
} from "../stories/made-up";
import type { MadeUpCategory } from "../stories/made-up";
import { Breakdown, BreakdownFigures, BreakdownSkeleton } from "./breakdown";
import type { BreakdownRow } from "./breakdown";
import { Button } from "./button";
import { SpendingChart } from "./spending-chart";

function rowsOf(categories: ReadonlyArray<MadeUpCategory>): Array<BreakdownRow> {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    icon: category.icon,
    amount: category.spent,
    benchmark: category.benchmark,
  }));
}

const october = rowsOf(CATEGORIES);

/** The list, with what a click chose written under it. */
function Choosing({ limit }: { limit?: number }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Breakdown
        rows={october}
        limit={all ? undefined : limit}
        onSelect={setChosen}
        onMore={() => setAll(true)}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        {chosen === null ? "Nothing chosen" : `Chosen: ${chosen}`}
      </p>
    </div>
  );
}

/** A row opens into its detail panel, and the panel closes back into its row. */
function Opening() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="max-w-xl">
      <Breakdown
        rows={october}
        limit={5}
        onSelect={setOpen}
        selectedId={open}
        onClose={() => setOpen(null)}
        benchmarkLabel="average"
        detail={<p className="text-sm text-muted-foreground">What it cost, day by day.</p>}
      />
    </div>
  );
}

/**
 * A row's detail with its figures: against its average and the month before. Open once the page
 * has hydrated: a panel opens on a click in the app, never in the server's markup.
 */
function OpenWithFigures() {
  const hydrated = useHydrated();
  const [chosen, setChosen] = useState<string | null>("groceries");
  const open = hydrated ? chosen : null;
  const row = october.find((each) => each.id === open);

  return (
    <div className="max-w-xl">
      <Breakdown
        rows={october}
        limit={5}
        onSelect={setChosen}
        selectedId={open}
        onClose={() => setChosen(null)}
        detail={
          row === undefined ? null : (
            <BreakdownFigures
              value={row.amount}
              label={`${row.name} against`}
              comparisons={[
                {
                  id: "average",
                  label: "Average",
                  reference: { minor: 39_500, currency: "EUR" },
                  referenceLabel: "your average",
                },
                {
                  id: "previous",
                  label: "September",
                  reference: { minor: 45_210, currency: "EUR" },
                  referenceLabel: "September",
                },
              ]}
            >
              <SpendingChart
                days={DAILY_SPENDING}
                currency="EUR"
                label={`${row.name} in October, against September`}
                currentLabel="October"
                previousLabel="September"
              />
            </BreakdownFigures>
          )
        }
      />
    </div>
  );
}

/** Switches between this month and the one before: the bars grow, the amounts roll. */
function SwitchingMonths() {
  const [current, setCurrent] = useState(true);

  return (
    <div className="flex max-w-xl flex-col items-start gap-4">
      <div className="w-full">
        <Breakdown rows={current ? october : rowsOf(PREVIOUS_CATEGORIES)} limit={5} />
      </div>
      <Button variant="secondary" onClick={() => setCurrent(!current)}>
        {current ? "Previous month" : "Next month"}
      </Button>
    </div>
  );
}

/**
 * Where the money goes (screen 1, block 2): one row per category, merchant or subject, with its
 * icon, its name, a bar and its amount in whole units. Every bar is on one scale, the largest
 * amount or benchmark of the list. The dark mark is the row's benchmark (its 6-month average);
 * once the month passes it, a ⚠ (labelled for screen readers) sits after the name. `limit` cuts
 * the list with "+ N more", or with `onMore` a button "Show the other N" (never "more" in a
 * button's name: the frame's menu is "More"); with `onSelect`, each row is a button.
 * Without rows, a sentence (the page's own with `emptyText`).
 *
 * Loading: `BreakdownSkeleton`, as many rows as the block shows, same heights.
 *
 * Motion: when the month changes, each bar grows or shrinks to its new length and its mark
 * slides, in 200 ms (ease-out), and the amounts roll; a row's background fades in 150 ms on
 * hover. Cut under reduced motion.
 *
 * Don't: sort it other than by amount, mix spending and income in one list, or show more than a
 * screen of rows without a limit.
 */
const meta = {
  title: "Money/Breakdown",
  component: Breakdown,
  args: { rows: october },
} satisfies Meta<typeof Breakdown>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Five rows and "Show the other 3", each row clickable. */
export const Default: Story = { render: () => <Choosing limit={5} /> };

/** Every row, nothing to click. */
export const ReadOnly: Story = {};

/** Merchants: no benchmark, so no mark. */
export const Merchants: Story = {
  args: {
    rows: MERCHANTS.map((merchant) => ({
      id: merchant.id,
      name: merchant.name,
      icon: "merchant",
      amount: merchant.spent,
    })),
  },
};

/**
 * Merchants with their faces (#204): a logo, or initials on their colour, in place of the icon; the
 * row of the expenses with no merchant keeps its icon, in the same room.
 */
export const MerchantsWithAvatars: Story = {
  args: {
    rows: [
      ...MERCHANTS.map((merchant): BreakdownRow => ({
        id: merchant.id,
        name: merchant.name,
        avatar: {
          name: merchant.name,
          src: merchant.id === "greenmarket" ? MADE_UP_LOGO : undefined,
          color: merchant.id === "streamly" ? "red" : null,
        },
        amount: merchant.spent,
      })),
      {
        id: "no-merchant",
        name: "No merchant",
        icon: "merchant",
        amount: { minor: 2350, currency: "EUR" },
      },
    ],
  },
};

/**
 * Each kind of benchmark (#33): the average (Groceries, passed: ⚠), an amount the user set
 * (Leisure, passed: ⚠; Transport, reached, so not passed), none (Gifts: no mark), and a category
 * with nothing to average yet (Pets: no mark). A set benchmark is read "benchmark €100, set".
 */
export const Benchmarks: Story = {
  args: {
    rows: [
      {
        id: "groceries",
        name: "Groceries",
        icon: "groceries",
        amount: { minor: 43_000, currency: "EUR" },
        benchmark: { minor: 39_500, currency: "EUR" },
      },
      {
        id: "leisure",
        name: "Leisure",
        icon: "leisure",
        amount: { minor: 12_000, currency: "EUR" },
        benchmark: { minor: 10_000, currency: "EUR" },
        benchmarkSet: true,
      },
      {
        id: "transport",
        name: "Transport",
        icon: "transport",
        amount: { minor: 9000, currency: "EUR" },
        benchmark: { minor: 9000, currency: "EUR" },
        benchmarkSet: true,
      },
      {
        id: "gifts",
        name: "Gifts",
        icon: "gifts",
        amount: { minor: 6000, currency: "EUR" },
      },
      { id: "pets", name: "Pets", icon: "pets", amount: { minor: 2500, currency: "EUR" } },
    ],
  },
};

/** Nothing spent: the sentence. */
export const Empty: Story = { args: { rows: [] } };

/** The page's own sentence when empty. */
export const EmptyWithText: Story = {
  args: { rows: [], emptyText: "No subject this month. Tag a line to follow a project." },
};

/** A click opens the row into its detail: the row grows into the panel, the detail fades in. */
export const OpeningADetail: Story = { render: () => <Opening /> };

/**
 * An open row's figures (`BreakdownFigures`): each reference it is held against, its amount and
 * the change, aligned; the chart under them.
 */
export const DetailFigures: Story = { render: () => <OpenWithFigures /> };

/** The month changes: the bars grow to their new lengths. */
export const ChangingMonth: Story = { render: () => <SwitchingMonths /> };

/** On a French page (`<html lang="fr">`): amounts and words in French. */
export const French: Story = {
  args: { limit: 5 },
  render: (args) => (
    <InFrench>
      <Breakdown {...args} />
    </InFrench>
  ),
};

/** Loading: five rows and the "+ N more" line, shaped like `Default`. */
export const Loading: Story = { render: () => <BreakdownSkeleton rows={5} more /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Choosing limit={5} />,
};
