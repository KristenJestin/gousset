import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

import { monthOf } from "../lib/month";
import type { YearMonth } from "../lib/month";
import { MONTH } from "../stories/made-up";
import { MonthSwitcher } from "./month-switcher";

/** A switcher that holds its month, as a page would in its URL. */
function Switcher({ start, latest }: { start: YearMonth; latest?: YearMonth }) {
  const [month, setMonth] = useState(start);

  return <MonthSwitcher value={month} onChange={setMonth} latest={latest} />;
}

/** The page in French while the story is open: the month follows `<html lang>`. */
function InFrench() {
  useEffect(() => {
    const before = document.documentElement.lang;

    document.documentElement.lang = "fr";

    return () => {
      document.documentElement.lang = before;
    };
  }, []);

  return <Switcher start={MONTH} />;
}

/**
 * ‹ October 2026 ›, at the top of the monthly review: the month on screen, with the months before
 * and after a press away. The month is written in the page's language (`<html lang>`, through
 * `Intl`); next is disabled on the latest month (the current one unless `latest` says
 * otherwise). With the focus on either button, the Left and Right arrows move as well.
 *
 * Motion: the old label slides out and the new one slides in from the side it comes from, in
 * 200 ms, easing out. Cut under reduced motion: the label changes at once.
 *
 * Don't: let it reach a month in the future, reload the page on a change (the figures move to
 * their new values instead), or put a date picker in its place for a month.
 */
const meta = {
  title: "Data/MonthSwitcher",
  component: MonthSwitcher,
  args: { value: MONTH, onChange: () => undefined },
  render: (args) => <Switcher start={args.value} latest={args.latest} />,
} satisfies Meta<typeof MonthSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

/** October 2026, with November the latest month: both ways open. */
export const Default: Story = { args: { latest: { year: 2026, month: 11 } } };

/** The current month: next is disabled. */
export const CurrentMonth: Story = {
  render: () => <Switcher start={monthOf(new Date())} />,
};

/** Across a year's end. */
export const January: Story = {
  args: { value: { year: 2026, month: 1 }, latest: { year: 2026, month: 11 } },
};

/** On a French page: "octobre 2026", its first letter raised. */
export const French: Story = { render: () => <InFrench /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { latest: { year: 2026, month: 11 } },
};
