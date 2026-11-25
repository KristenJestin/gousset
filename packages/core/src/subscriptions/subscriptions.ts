import { UserData } from "@gousset/db/user-data";
import type { QueryFailed } from "@gousset/db/user-data";
import { Context, Effect, Layer } from "effect";

import { AccountStore } from "../account-store";
import type { AccountRecord } from "../account-store";
import { creditsLeft, expiringOf } from "../credits";
import type { CountedLine } from "../credits";
import { FutureMonthRefused } from "../errors";
import type { Money } from "../month";
import { today } from "../today";
import { addMonths } from "../values";
import { chargesIn } from "./charges";
import { calendarDays, detectSubscriptions, subscriptionsOfMonth } from "./detection";
import type { CalendarItem, Charge, MonthSubscriptions } from "./detection";

// The subscriptions (#34; docs/data-model.md, v0.4): detected on read from the user's expenses,
// never stored. A detection depends on today (a payment that did not come) and on every edit of the
// user's (a split, a link, a merge, a moved cleaned label, a rule): a stored table would go stale.
// The user's answer is the one thing kept, on the merchant (`subscription_dismissed`): a dismissed
// merchant's charges are never read (`./charges`).

/** How far back the charges are read: three years before the day detection looks from. */
export const CHARGE_YEARS = 3;

/** Where the charges are read from. The live layer goes through `UserData`. */
export class Subscriptions extends Context.Service<
  Subscriptions,
  {
    /** The user's expenses that happened from `from` to `to`, both included, as charges. */
    readonly charges: (
      owner: string,
      range: { readonly from: string; readonly to: string },
    ) => Effect.Effect<ReadonlyArray<Charge>, QueryFailed>;
  }
>()("@gousset/core/Subscriptions") {}

/** `Subscriptions` on the database, through `UserData`. */
export const subscriptionsLayer = Layer.effect(
  Subscriptions,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      charges: (owner, range) =>
        userData.transaction(owner, (transaction) => chargesIn(transaction, range)),
    };
  }),
);

/** A month's subscriptions as of `asOf`: the month's last day, or today in the current month. */
export type MonthSubscriptionsRead = MonthSubscriptions & {
  readonly month: string;
  readonly asOf: string;
};

/** What is left of a benefit account's credits on the day they expire, on the calendar. */
export type ExpiringCredit = {
  readonly id: string;
  readonly day: string;
  readonly kind: "expiring";
  readonly accountId: string;
  /** The account's name. */
  readonly name: string;
  /** What is left on the credits expiring that day, as of the calendar's today. */
  readonly amount: Money;
};

/** The days of a month and the next one: the subscriptions paid, due or stopped, and expiries. */
export type SubscriptionCalendar = {
  readonly month: string;
  readonly from: string;
  readonly to: string;
  /** The day detection looked from: today, or the range's last day when it is past. */
  readonly asOf: string;
  /** Every day's items, by day. */
  readonly items: ReadonlyArray<CalendarItem | ExpiringCredit>;
};

/** The last day of `month` (`YYYY-MM`). */
function lastDayOf(month: string): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, number, 0)).getUTCDate();

  return `${month}-${String(day).padStart(2, "0")}`;
}

/** The day `years` years before `day`; the 29th of February goes to the 1st of March. */
function yearsBefore(day: string, years: number): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);

  return new Date(Date.UTC(year - years, month - 1, date)).toISOString().slice(0, 10);
}

const earlier = (a: string, b: string) => (a < b ? a : b);

/** Today, after refusing a month to come (`FutureMonthRefused`). */
export const checkedToday = (month: string) =>
  Effect.gen(function* () {
    const day = yield* today;
    const current = day.slice(0, 7);

    if (month > current) {
      return yield* new FutureMonthRefused({ month, current });
    }

    return day;
  });

/** The days whose charges a detection as of `asOf` reads: the three years up to it. */
export const chargeRange = (asOf: string) => ({ from: yearsBefore(asOf, CHARGE_YEARS), to: asOf });

/** The subscriptions detected as of `asOf`, from the three years of charges before it. */
const detectedAsOf = (owner: string, asOf: string) =>
  Effect.gen(function* () {
    const store = yield* Subscriptions;
    const charges = yield* store.charges(owner, chargeRange(asOf));

    return detectSubscriptions(charges, asOf);
  });

/**
 * A month's subscriptions (#34): the payments that recur, those that stopped and the prices that
 * rose, detected as of the month's last day, or today in the current month. A month to come is
 * refused (`FutureMonthRefused`).
 */
export const monthSubscriptions = (owner: string, month: string) =>
  Effect.gen(function* () {
    const day = yield* checkedToday(month);
    const asOf = earlier(lastDayOf(month), day);
    const detected = yield* detectedAsOf(owner, asOf);

    const read: MonthSubscriptionsRead = {
      month,
      asOf,
      ...subscriptionsOfMonth(detected, month, asOf),
    };

    return read;
  });

/** An open benefit account kept by its lines: the accounts whose credits expire. */
export const followsCredits = (account: Pick<AccountRecord, "kind" | "mode" | "closedOn">) =>
  account.kind === "benefit" && account.mode === "lines" && account.closedOn === null;

/**
 * What is left on an account's credits on each day they expire from `from` to `to`, replayed from
 * its counted `lines` (booked up to the day it looks from, oldest first). For the calendar and the
 * month's flags alike.
 */
export function expiringCreditsOf(
  account: Pick<AccountRecord, "id" | "name" | "currency" | "openingBalanceMinor" | "creditOrder">,
  lines: ReadonlyArray<CountedLine>,
  range: { readonly from: string; readonly to: string },
): ReadonlyArray<ExpiringCredit> {
  return expiringOf(
    creditsLeft(account.openingBalanceMinor, lines, account.creditOrder).credits,
  ).flatMap(({ day, minor }): ReadonlyArray<ExpiringCredit> =>
    day >= range.from && day <= range.to
      ? [
          {
            id: `expiring:${account.id}:${day}`,
            day,
            kind: "expiring",
            accountId: account.id,
            name: account.name,
            amount: { minor, currency: account.currency },
          },
        ]
      : [],
  );
}

/** What expires on the user's benefit accounts kept by their lines, from `from` to `to`. */
const expiringCredits = (
  owner: string,
  range: { readonly from: string; readonly to: string },
  asOf: string,
) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const facts = yield* accounts.facts(owner, asOf);
    const benefit = facts.filter(({ account }) => followsCredits(account));

    const expiring = yield* Effect.forEach(benefit, ({ account }) =>
      Effect.map(accounts.countedLines(owner, account.id, asOf), (lines) =>
        expiringCreditsOf(account, lines, range),
      ),
    );

    return expiring.flat();
  });

/**
 * The calendar of a month and the next one (#34), for the monthly review: each subscription's
 * payments made, those expected and those that did not come, and what is left on a benefit
 * account's credits on the day they expire. Detected as of today, or of the range's last day when it
 * is past. A month to come is refused (`FutureMonthRefused`).
 */
export const subscriptionCalendar = (owner: string, month: string) =>
  Effect.gen(function* () {
    const day = yield* checkedToday(month);
    const from = `${month}-01`;
    const to = lastDayOf(addMonths(month, 1));
    const asOf = earlier(to, day);
    const detected = yield* detectedAsOf(owner, asOf);
    const expiring = yield* expiringCredits(owner, { from, to }, asOf);

    const items = [...calendarDays(detected, from, to, asOf), ...expiring].toSorted(
      (a, b) =>
        a.day.localeCompare(b.day) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );

    const calendar: SubscriptionCalendar = { month, from, to, asOf, items };

    return calendar;
  });
