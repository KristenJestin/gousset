import { MonthSwitcher } from "@gousset/ui/components/month-switcher";

import { fromYearMonth, toYearMonth } from "@/lib/month";

type MonthSwitchProps = {
  /** The month on screen, `YYYY-MM`. */
  month: string;
  /** The current month on the server's clock: the latest one reached. */
  currentMonth: string;
  /** Goes to another month: the screen writes it in its URL. */
  onChange: (month: string) => void;
};

/** The month switcher of a month's screen, on the URL's `YYYY-MM` months. */
export function MonthSwitch({ month, currentMonth, onChange }: MonthSwitchProps) {
  return (
    <MonthSwitcher
      value={toYearMonth(month)}
      latest={toYearMonth(currentMonth)}
      onChange={(next) => onChange(fromYearMonth(next))}
    />
  );
}
