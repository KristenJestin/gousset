import type { Meta, StoryObj } from "@storybook/react-vite";

import { DatePicker } from "./date-picker";

/** Puts the page in a language for one story, as the app does on `<html lang>`, then back. */
function pageLanguage(lang: string) {
  return () => {
    const before = document.documentElement.lang;

    document.documentElement.lang = lang;

    return () => {
      document.documentElement.lang = before;
    };
  };
}

/**
 * A day, typed or chosen in a calendar, on ui-sdk's `DatePicker`. The input reads a date typed in
 * the page's order (on Enter or when it is left) and the hint under it shows that order; the
 * button opens the calendar (Alt+Arrow Down from the input too), where arrows move by day and by
 * week, Page Up and Page Down by month, and Enter picks. In French, dates are day first and weeks
 * start on Monday. The page receives an ISO date ("2026-10-16").
 *
 * Motion: the calendar fades in with a slight scale from the field (150 ms, ease-out) and leaves
 * the same way; cut under reduced motion.
 *
 * Don't: use it for a month (that is `MonthSwitcher`), turn its value into a `Date` in the page's
 * time zone, or restyle it in a page.
 */
const meta = {
  title: "Forms/DatePicker",
  component: DatePicker,
  args: { label: "Paid on", name: "paid-on" },
} satisfies Meta<typeof DatePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Chosen: Story = { args: { defaultValue: "2026-10-16" } };

export const WithDescription: Story = {
  args: { description: "The day the money left the account.", defaultValue: "2026-10-16" },
};

/** Only the days of one month can be chosen; the others are dimmed and skipped. */
export const MinAndMax: Story = {
  args: { defaultValue: "2026-10-16", min: "2026-10-01", max: "2026-10-31" },
};

export const Required: Story = { args: { required: true } };

export const Error: Story = {
  args: { defaultValue: "2026-12-02", error: "This day is after the end of the statement." },
};

export const Disabled: Story = { args: { disabled: true, defaultValue: "2026-10-16" } };

/** The page in French: day first, months and days named in French, weeks from Monday. */
export const French: Story = {
  beforeEach: pageLanguage("fr"),
  args: { label: "Payé le", defaultValue: "2026-10-16" },
};

export const Small: Story = { args: { size: "sm", defaultValue: "2026-10-16" } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "The day the money left the account.", defaultValue: "2026-10-16" },
};
