import { useState } from "react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { calendarWeeks, monthKey, parseMonth } from "../lib/calendar";
import type { UiMessages } from "../lib/messages";
import { addMonths, formatMonth } from "../lib/month";
import type { YearMonth } from "../lib/month";
import { formatMoney } from "../lib/money";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Chip } from "./chip";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { MonthSwitcher } from "./month-switcher";
import { RestrictedAmount } from "./restricted-amount";
import { Tab, Tabs, TabsList, TabsPanel } from "./tabs";

/**
 * What a day holds. `paid`: a subscription's payment, already booked; `due`: one expected;
 * `stopped`: the expected day of a payment that did not come; `expiring`: a benefit credit's last
 * day.
 */
export type RecurringKind = "paid" | "due" | "stopped" | "expiring";

export type RecurringItem = {
  id: string;
  /** `YYYY-MM-DD`: the day it was booked, is expected, or expires. */
  day: string;
  kind: RecurringKind;
  /** The merchant, or the benefit account whose credit expires. */
  name: string;
  /** What was paid, is expected, or is left on the expiring credit. */
  amount: Money;
  /** It costs more than before: what it cost then, in the same currency. */
  priceRise: { beforeMinor: number } | null;
};

export type RecurringView = "month" | "agenda";

export type RecurringCalendarProps = {
  /** The month shown, `YYYY-MM`. */
  month: string;
  /** Today, `YYYY-MM-DD`: marked in the month, and the first month it may show. */
  today: string;
  /** What recurs; those outside `month` are left out. */
  items: ReadonlyArray<RecurringItem>;
  /** The view, to control it; leave it out and `defaultView` starts. */
  view?: RecurringView;
  defaultView?: RecurringView;
  onViewChange?: (view: RecurringView) => void;
  /** Moves between today's month and the next; without it, the month is only named. */
  onMonthChange?: (month: string) => void;
};

/** Each kind's mark: an icon of its own, so that it never reads by its colour alone. */
const MARKS = {
  paid: { icon: "check", tone: "text-muted-foreground" },
  due: { icon: "recurring", tone: "text-foreground" },
  stopped: { icon: "error", tone: "text-destructive" },
  expiring: { icon: "expiring", tone: "text-soft-foreground" },
} satisfies { [Kind in RecurringKind]: { icon: IconName; tone: string } };

const KINDS = [
  "paid",
  "due",
  "stopped",
  "expiring",
] as const satisfies ReadonlyArray<RecurringKind>;

function kindWord(messages: UiMessages["recurring"], kind: RecurringKind) {
  switch (kind) {
    case "paid": {
      return messages.paid;
    }

    case "due": {
      return messages.due;
    }

    case "stopped": {
      return messages.stopped;
    }

    case "expiring": {
      return messages.expiring;
    }
  }
}

/** How the content came in: the side a month comes from, or a view switched. */
type Entrance = "none" | "later" | "earlier" | "view";

// The content slides in from the side its month comes from, or fades in for another view; the
// first paint does not move. CSS animations, cut under reduced motion by `globals.css`.
const ENTRANCES = {
  none: "",
  later: "animate-in fade-in slide-in-from-right-4 fill-mode-both duration-200",
  earlier: "animate-in fade-in slide-in-from-left-4 fill-mode-both duration-200",
  view: "animate-in fade-in fill-mode-both duration-200",
} satisfies { [Kind in Entrance]: string };

function entranceOf(from: string, to: string): Entrance {
  if (from === to) {
    return "view";
  }

  return to > from ? "later" : "earlier";
}

function isView(value: string): value is RecurringView {
  return value === "month" || value === "agenda";
}

/** The week's days from its first, short and whole, in the page's language. */
function weekdayNames(locale: string, weekStartsOn: number) {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });

  return Array.from({ length: 7 }, (_, column) => {
    // 4 January 1970 was a Sunday.
    const date = new Date(Date.UTC(1970, 0, 4 + ((weekStartsOn + column) % 7)));

    return { short: short.format(date), long: long.format(date) };
  });
}

function priceRiseText(item: RecurringItem, locale: string, messages: UiMessages["recurring"]) {
  if (item.priceRise === null) {
    return null;
  }

  const before = { minor: item.priceRise.beforeMinor, currency: item.amount.currency };

  return messages.priceRiseFrom(formatMoney(before, { locale }));
}

/** One payment or credit in a day of the month: its mark on a phone, its words from `sm` on. */
function GridItem({ item, locale }: { item: RecurringItem; locale: string }) {
  const messages = useUiMessages().recurring;
  const mark = MARKS[item.kind];
  const rise = priceRiseText(item, locale, messages);
  const amount = formatMoney(item.amount, { locale });

  return (
    <li
      data-slot="recurring-item"
      data-kind={item.kind}
      className={cn("flex min-w-0 items-start gap-1", mark.tone)}
    >
      <span className="flex h-4 items-center">
        <Icon name={mark.icon} size="sm" />
      </span>
      {rise === null ? null : (
        <span className="flex h-4 items-center text-warning sm:hidden">
          <Icon name="up" size="sm" />
        </span>
      )}
      {/* Said on a phone too, where only the marks are drawn. */}
      <span className="sr-only sm:not-sr-only sm:flex sm:min-w-0 sm:flex-1 sm:flex-col">
        <span className="sr-only">{kindWord(messages, item.kind)}: </span>
        <span className="truncate text-xs leading-4 font-medium">{item.name}</span>
        <span className="flex items-center gap-1 text-xs leading-4">
          <span
            className={cn(
              "tabular-nums",
              item.kind === "stopped" && "line-through",
              item.kind === "expiring" && "rounded-sm bg-hatched-restricted px-1",
            )}
          >
            {amount}
          </span>
          {rise === null ? null : (
            <span className="flex items-center text-warning">
              <Icon name="up" size="sm" />
              <span className="sr-only">{rise}</span>
            </span>
          )}
        </span>
      </span>
    </li>
  );
}

function MonthGrid({
  month,
  todayDay,
  byDay,
}: {
  month: YearMonth;
  /** Today's day in this month, or `null` when today is in another. */
  todayDay: number | null;
  byDay: ReadonlyMap<number, ReadonlyArray<RecurringItem>>;
}) {
  const ui = useUiMessages();
  const messages = ui.recurring;
  const locale = usePageLanguage();
  const weekStartsOn = ui.forms.weekStartsOn;

  return (
    <table data-slot="recurring-month" className="w-full table-fixed border-collapse">
      <caption className="sr-only">{formatMonth(month, locale)}</caption>
      <thead>
        <tr>
          {weekdayNames(locale, weekStartsOn).map((name) => (
            <th
              key={name.long}
              scope="col"
              className="h-6 truncate text-xs font-medium text-muted-foreground"
            >
              <span aria-hidden="true">{name.short}</span>
              <span className="sr-only">{name.long}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calendarWeeks(month, weekStartsOn).map((week, row) => (
          <tr key={row}>
            {week.map((day, column) => {
              if (day === null) {
                return <td key={column} className="border bg-muted/40" />;
              }

              const items = byDay.get(day) ?? [];
              const isToday = day === todayDay;

              return (
                <td
                  key={column}
                  data-slot="recurring-day"
                  aria-current={isToday ? "date" : undefined}
                  className="h-14 border p-1 align-top sm:h-24 sm:p-1.5"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span
                      className={cn(
                        "grid size-5 place-items-center rounded-full text-xs tabular-nums",
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {day}
                      {isToday ? <span className="sr-only">, {messages.today}</span> : null}
                    </span>
                    {items.length === 0 ? null : (
                      <ul className="flex flex-wrap gap-0.5 sm:flex-col sm:flex-nowrap sm:gap-1">
                        {items.map((item) => (
                          <GridItem key={item.id} item={item} locale={locale} />
                        ))}
                      </ul>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What each mark means, under the month: the words the phone's marks stand for. */
function Legend() {
  const messages = useUiMessages().recurring;

  return (
    <ul
      aria-label={messages.legend}
      data-slot="recurring-legend"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {KINDS.map((kind) => (
        <li key={kind} className="flex h-5 items-center gap-1.5">
          <span className={cn("flex", MARKS[kind].tone)}>
            <Icon name={MARKS[kind].icon} size="sm" />
          </span>
          {kindWord(messages, kind)}
        </li>
      ))}
      <li className="flex h-5 items-center gap-1.5">
        <span className="flex text-warning">
          <Icon name="up" size="sm" />
        </span>
        {messages.priceRise}
      </li>
    </ul>
  );
}

function AgendaAmount({ item, locale }: { item: RecurringItem; locale: string }) {
  if (item.kind === "expiring") {
    return <RestrictedAmount value={item.amount} size="sm" locale={locale} />;
  }

  if (item.kind === "stopped") {
    return (
      <span className="text-sm font-medium text-muted-foreground tabular-nums line-through">
        {formatMoney(item.amount, { locale })}
      </span>
    );
  }

  return <Amount value={item.amount} size="sm" locale={locale} roll={false} />;
}

/** One formatter per language, made once: an agenda's day headings all share it. */
const agendaDayFormats = new Map<string, Intl.DateTimeFormat>();

function agendaDayFormat(locale: string): Intl.DateTimeFormat {
  const known = agendaDayFormats.get(locale);

  if (known !== undefined) {
    return known;
  }

  const made = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  agendaDayFormats.set(locale, made);

  return made;
}

function Agenda({
  month,
  todayDay,
  byDay,
}: {
  month: YearMonth;
  todayDay: number | null;
  byDay: ReadonlyMap<number, ReadonlyArray<RecurringItem>>;
}) {
  const messages = useUiMessages().recurring;
  const locale = usePageLanguage();

  const dayFormat = agendaDayFormat(locale);
  const days = [...byDay.entries()].toSorted(([a], [b]) => a - b);

  return (
    <ol data-slot="recurring-agenda" className="flex flex-col gap-4">
      {days.map(([day, items]) => (
        <li key={day} className="flex flex-col gap-1">
          <h3 className="flex h-6 items-center gap-2 text-sm font-semibold">
            <time
              dateTime={`${monthKey(month)}-${String(day).padStart(2, "0")}`}
              className="first-letter:uppercase"
            >
              {dayFormat.format(new Date(Date.UTC(month.year, month.month - 1, day)))}
            </time>
            {day === todayDay ? <Chip>{messages.today}</Chip> : null}
          </h3>
          <ul className="flex flex-col divide-y">
            {items.map((item) => {
              const mark = MARKS[item.kind];
              const rise = priceRiseText(item, locale, messages);

              return (
                <li
                  key={item.id}
                  data-slot="recurring-item"
                  data-kind={item.kind}
                  className="flex min-h-12 items-center gap-3 py-2"
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-md bg-muted",
                      mark.tone,
                    )}
                  >
                    <Icon name={mark.icon} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span
                      className={cn(
                        "text-xs",
                        item.kind === "stopped" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {kindWord(messages, item.kind)}
                    </span>
                    {rise === null ? null : (
                      <span className="flex items-center gap-1 text-xs text-warning">
                        <Icon name="up" size="sm" />
                        {rise}
                      </span>
                    )}
                  </span>
                  <AgendaAmount item={item} locale={locale} />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/**
 * The recurring payments of a month, read only (docs/vision.md, subscriptions): each payment on
 * its day with its amount, paid or due; an expected payment that did not come, and a price rise,
 * marked; a benefit credit's last day with what is left on it and its account. Two views: the
 * month as a grid (on a phone, each payment as its mark alone, its words said to screen readers
 * and named in the legend) and the agenda, a list of the days that hold something. With
 * `onMonthChange`, it moves between today's month and the next.
 *
 * Motion: switching the view, the tab's background slides (200 ms, `Tabs`) and the new view fades
 * in (200 ms, ease-out); changing the month, the label slides (`MonthSwitcher`) and the content
 * slides in from the side its month comes from as it fades in (200 ms, ease-out). The first paint
 * does not move. Everything is cut under reduced motion.
 */
export function RecurringCalendar({
  month,
  today,
  items,
  view,
  defaultView = "month",
  onViewChange,
  onMonthChange,
}: RecurringCalendarProps) {
  const messages = useUiMessages().recurring;
  const locale = usePageLanguage();
  const [ownView, setOwnView] = useState<RecurringView>(defaultView);
  const shownView = view ?? ownView;
  const [seen, setSeen] = useState({ month, view: shownView });
  const [entrance, setEntrance] = useState<Entrance>("none");

  // What changed since the last paint decides how the content comes in.
  if (seen.month !== month || seen.view !== shownView) {
    setEntrance(entranceOf(seen.month, month));
    setSeen({ month, view: shownView });
  }

  const shown = parseMonth(month);
  const current = parseMonth(today.slice(0, 7));
  const todayDay = today.startsWith(month) ? Number(today.slice(8, 10)) : null;
  const byDay = new Map<number, Array<RecurringItem>>();

  for (const item of items) {
    if (item.day.startsWith(`${month}-`)) {
      const day = Number(item.day.slice(8, 10));
      const list = byDay.get(day) ?? [];

      list.push(item);
      byDay.set(day, list);
    }
  }

  const empty =
    byDay.size === 0 ? (
      <p className="flex h-10 items-center text-sm text-muted-foreground">{messages.empty}</p>
    ) : null;

  const body = (content: ReactNode) => (
    <div className="overflow-hidden">
      <div
        key={month}
        data-slot="recurring-calendar-body"
        data-entrance={entrance}
        className={cn("flex flex-col gap-3", ENTRANCES[entrance])}
      >
        {content}
      </div>
    </div>
  );

  return (
    <div data-slot="recurring-calendar">
      <Tabs
        value={shownView}
        onValueChange={(next) => {
          if (isView(next)) {
            setOwnView(next);
            onViewChange?.(next);
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {onMonthChange === undefined ? (
            <span className="flex h-9 items-center text-sm font-medium first-letter:uppercase">
              {formatMonth(shown, locale)}
            </span>
          ) : (
            <MonthSwitcher
              value={shown}
              earliest={current}
              latest={addMonths(current, 1)}
              label={messages.month}
              onChange={(next) => onMonthChange(monthKey(next))}
            />
          )}
          <TabsList label={messages.views}>
            <Tab value="month" icon="calendar">
              {messages.viewMonth}
            </Tab>
            <Tab value="agenda" icon="operations">
              {messages.viewAgenda}
            </Tab>
          </TabsList>
        </div>
        <TabsPanel value="month">
          {shownView === "month"
            ? body(
                <>
                  <MonthGrid month={shown} todayDay={todayDay} byDay={byDay} />
                  {empty}
                  <Legend />
                </>,
              )
            : null}
        </TabsPanel>
        <TabsPanel value="agenda">
          {shownView === "agenda"
            ? body(empty ?? <Agenda month={shown} todayDay={todayDay} byDay={byDay} />)
            : null}
        </TabsPanel>
      </Tabs>
    </div>
  );
}
