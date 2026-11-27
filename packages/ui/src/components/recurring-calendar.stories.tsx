import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { MADE_UP_LOGO } from "../stories/made-up";
import { RecurringCalendar } from "./recurring-calendar";
import type { RecurringItem, RecurringView } from "./recurring-calendar";

const eur = (minor: number) => ({ minor, currency: "EUR" });

// The shared made-up person's subscriptions (packages/fixture): rent to Glycine Homes, Pixelplay,
// Streamly (8.99 until September 2026, 9.49 from October), the Riverside Gym, and the MealCard
// credit that expires on 31 October. Pocketline Mobile and Nimbusfold are invented here.
const TODAY = "2026-10-24";

const item = (
  id: string,
  day: string,
  kind: RecurringItem["kind"],
  name: string,
  minor: number,
  beforeMinor?: number,
): RecurringItem => ({
  id,
  day,
  kind,
  name,
  amount: eur(minor),
  priceRise: beforeMinor === undefined ? null : { beforeMinor },
});

const STREAMLY_RISE = item("oct-streamly", "2026-10-15", "paid", "Streamly", 949, 899);
const STOPPED = item("oct-nimbusfold", "2026-10-20", "stopped", "Nimbusfold", 299);
const EXPIRING = item("oct-mealcard", "2026-10-31", "expiring", "MealCard", 12_000);

const ITEMS: ReadonlyArray<RecurringItem> = [
  item("oct-rent", "2026-10-05", "paid", "Glycine Homes", 69_000),
  item("oct-pixelplay", "2026-10-12", "paid", "Pixelplay", 1499),
  STREAMLY_RISE,
  STOPPED,
  item("oct-pocketline", "2026-10-28", "due", "Pocketline Mobile", 1999),
  item("oct-gym", "2026-10-30", "due", "Riverside Gym", 3500),
  EXPIRING,
  item("nov-rent", "2026-11-05", "due", "Glycine Homes", 69_000),
  item("nov-pixelplay", "2026-11-12", "due", "Pixelplay", 1499),
  item("nov-streamly", "2026-11-15", "due", "Streamly", 949),
  item("nov-pocketline", "2026-11-28", "due", "Pocketline Mobile", 1999),
  item("nov-gym", "2026-11-30", "due", "Riverside Gym", 3500),
];

/** The calendar holding its month, as a page would in its URL: October, then November. */
function Browsing({
  items = ITEMS,
  defaultView,
}: {
  items?: ReadonlyArray<RecurringItem>;
  defaultView?: RecurringView;
}) {
  const [month, setMonth] = useState("2026-10");

  return (
    <div className="max-w-4xl">
      <RecurringCalendar
        month={month}
        today={TODAY}
        items={items}
        defaultView={defaultView}
        onMonthChange={setMonth}
      />
    </div>
  );
}

/**
 * The recurring payments of a month, read only: each payment on its day with its amount, a check
 * once paid, a loop while due; an expected payment that did not come (a red mark, its amount
 * struck through) and a price rise (an arrow up, with the old price) marked on it; a benefit
 * credit's last day with what is left on it (hatched) and its account. Two views, Month and Agenda,
 * switched by tabs; with `onMonthChange`, today's month and the next a press away.
 *
 * On a phone the month keeps its grid, each payment drawn as its mark alone (its words said to
 * screen readers), the legend under it naming the marks; the agenda gives the words.
 *
 * Motion: switching the view, the tab's background slides and the new view fades in (200 ms);
 * changing the month, the content slides in from the side its month comes from as it fades in
 * (200 ms, ease-out), while the month's label slides. Cut under reduced motion.
 *
 * Don't: drag, resize or add anything here: the payments come from the statements.
 */
const meta = {
  title: "Money/RecurringCalendar",
  component: RecurringCalendar,
  args: { month: "2026-10", today: TODAY, items: ITEMS },
  render: (args) => (
    <div className="max-w-4xl">
      <RecurringCalendar {...args} />
    </div>
  ),
} satisfies Meta<typeof RecurringCalendar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** October 2026, today the 24th: November a press away, and the agenda a tab away. */
export const Default: Story = { render: () => <Browsing /> };

/** The same month as a list of the days that hold something. */
export const AgendaView: Story = { render: () => <Browsing defaultView="agenda" /> };

/** Streamly's payment of 15 October costs €9.49, up from €8.99. */
export const PriceRise: Story = { args: { items: [STREAMLY_RISE], defaultView: "agenda" } };

/** Nimbusfold's payment was expected on 20 October and did not come. */
export const Stopped: Story = { args: { items: [STOPPED], defaultView: "agenda" } };

/** The MealCard credit's last day, with what is left on it. */
export const ExpiringCredit: Story = { args: { items: [EXPIRING] } };

/**
 * Each merchant's face in the agenda (#204): a logo, or initials on their colour, in place of the
 * kind's tile, whose mark goes before the kind's word; the expiring credit keeps its tile.
 */
const WITH_AVATARS: ReadonlyArray<RecurringItem> = ITEMS.map((each): RecurringItem =>
  each.kind === "expiring"
    ? each
    : {
        ...each,
        avatar: {
          name: each.name,
          src: each.name === "Pixelplay" ? MADE_UP_LOGO : undefined,
          color: each.name === "Streamly" ? "red" : null,
        },
      },
);

export const AgendaWithAvatars: Story = {
  render: () => <Browsing items={WITH_AVATARS} defaultView="agenda" />,
};

export const PhoneAgendaWithAvatars: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Browsing items={WITH_AVATARS} defaultView="agenda" />,
};

/** Nothing recurs this month: the grid stays, and says so. */
export const EmptyMonth: Story = { args: { items: [] } };

/** Nothing recurs this month, in the agenda. */
export const EmptyAgenda: Story = { args: { items: [], defaultView: "agenda" } };

/** Without `onMonthChange`, the month is only named. */
export const FixedMonth: Story = {};

/** On a French page (`<html lang="fr">`): the week starts on Monday, words and amounts in French. */
export const French: Story = {
  render: () => (
    <InFrench>
      <Browsing />
    </InFrench>
  ),
};

/** On a phone, the month's grid draws each payment as its mark. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Browsing />,
};

export const PhoneAgenda: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Browsing defaultView="agenda" />,
};
