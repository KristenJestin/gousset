import { addDays } from "../balances";
import type { Money } from "../month";
import { addMonths } from "../values";

// The pure logic that finds subscriptions among a user's expenses (#34): series of charges paid to
// one merchant at a steady cadence and price. Conservative: a false subscription is worse than a
// missed one, so every doubt refuses a series.

/** The cadences a subscription may have, shortest first: the order they are tried in. */
export const CADENCES = ["weekly", "monthly", "yearly"] as const;

export type Cadence = (typeof CADENCES)[number];

/** How many days a charge may fall from the day its previous one leads to. */
export const TOLERANCE_DAYS = {
  weekly: 1,
  monthly: 3,
  yearly: 7,
} as const satisfies { readonly [Each in Cadence]: number };

/** The fewest charges a series of each cadence needs. */
export const MIN_CHARGES = {
  weekly: 4,
  monthly: 3,
  yearly: 2,
} as const satisfies { readonly [Each in Cadence]: number };

/** The most subscriptions one merchant may bill in one currency. */
export const SUBSCRIPTIONS_PER_MERCHANT = 3;

/** One expense paid to a merchant: an entry, its day, what its payments total. */
export type Charge = {
  readonly id: string;
  readonly merchantId: string;
  readonly merchant: string;
  /** `YYYY-MM-DD`. */
  readonly day: string;
  /** Positive, in minor units of `currency`. */
  readonly amountMinor: number;
  readonly currency: string;
};

export type Subscription = {
  readonly merchantId: string;
  readonly merchant: string;
  readonly currency: string;
  readonly cadence: Cadence;
  /** The series, oldest first. */
  readonly charges: ReadonlyArray<Charge>;
  /** The price as it stands: a new price counts once it was charged twice. */
  readonly usualMinor: number;
  readonly lastOn: string;
  readonly lastMinor: number;
  /** The last charge's day plus one step of the cadence. */
  readonly nextOn: string;
  /** Set when the last charge rose above the usual price, and alone at its price. */
  readonly priceRise: { readonly fromMinor: number; readonly toMinor: number } | null;
  /** `nextOn`, once `asOf` is past it and its tolerance; else null. */
  readonly stoppedOn: string | null;
};

/** A month's subscriptions: those that go on, those seen stopping in it, its price rises. */
export type MonthSubscriptions = {
  readonly recurring: ReadonlyArray<Subscription>;
  readonly stopped: ReadonlyArray<Subscription>;
  readonly rises: ReadonlyArray<Subscription>;
};

/** One item of a calendar of subscriptions. */
export type CalendarItem = {
  /** Stable from one call to the next, and unique among the items. */
  readonly id: string;
  readonly day: string;
  readonly kind: "paid" | "due" | "stopped";
  /** The merchant's name. */
  readonly name: string;
  readonly merchantId: string;
  readonly amount: Money;
  readonly priceRise: { readonly beforeMinor: number } | null;
};

/** How many days, at least and at most, one step of each cadence spans before its tolerance. */
const STEP_DAYS = {
  weekly: [7, 7],
  monthly: [28, 31],
  yearly: [365, 366],
} as const satisfies { readonly [Each in Cadence]: readonly [number, number] };

const DAY_MS = 86_400_000;

/** The day one step of `cadence` after `day`: a week, or the same day of the next month or year,
 * clamped to that month's last day (31 January → 28 February, 29 February → 28 February). */
export function nextDay(day: string, cadence: Cadence): string {
  if (cadence === "weekly") {
    return addDays(day, 7);
  }

  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const target = cadence === "monthly" ? [year, month] : [year + 1, month - 1];
  const [targetYear = 0, targetMonth = 0] = target;
  const lastDate = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date, lastDate)))
    .toISOString()
    .slice(0, 10);
}

/** The day as a count of days, for arithmetic on windows. */
function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** The same price: within 2 % of the earlier amount, in integers (|a − b| ≤ earlier / 50). */
function sameAmount(earlierMinor: number, laterMinor: number): boolean {
  return Math.abs(laterMinor - earlierMinor) * 50 <= earlierMinor;
}

/** A charge of a group with its day as a number and the day each cadence leads to after it. */
type Slot = {
  readonly charge: Charge;
  readonly at: number;
  readonly next: { readonly [Each in Cadence]: number };
};

/** Consecutive charges of a series at one price; `amountMinor` is its newest charge's. */
type Plateau = { readonly amountMinor: number; count: number };

/** A series found in a group: its slots and its plateaus, both newest first. */
type Found = {
  readonly cadence: Cadence;
  readonly indexes: ReadonlyArray<number>;
  readonly plateaus: ReadonlyArray<Plateau>;
};

/** The first index of `slots` (by day) whose day is on or after `at`. */
function firstFrom(slots: ReadonlyArray<Slot>, at: number): number {
  let low = 0;
  let high = slots.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if ((slots[middle]?.at ?? Number.POSITIVE_INFINITY) < at) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/**
 * The charge before `current` in a series of `cadence`: among the unused charges whose next day is
 * within the tolerance of `current`'s, the closest in amount; ties go to the closest to the
 * schedule, then the latest, then the latest in order (by day, then id).
 */
function previousOf(
  slots: ReadonlyArray<Slot>,
  used: ReadonlyArray<boolean>,
  current: Slot,
  cadence: Cadence,
): number | null {
  const tolerance = TOLERANCE_DAYS[cadence];
  const [shortest, longest] = STEP_DAYS[cadence];
  const until = current.at - shortest + tolerance;
  let best: number | null = null;
  let bestAmount = 0;
  let bestDrift = 0;

  for (
    let index = firstFrom(slots, current.at - longest - tolerance);
    index < slots.length;
    index += 1
  ) {
    const slot = slots[index];

    if (slot === undefined || slot.at > until || slot.at >= current.at) {
      break;
    }

    const drift = Math.abs(current.at - slot.next[cadence]);

    if (used[index] === true || drift > tolerance) {
      continue;
    }

    const amount = Math.abs(slot.charge.amountMinor - current.charge.amountMinor);

    // Later candidates win ties, being met last in the order of the slots.
    if (best === null || amount < bestAmount || (amount === bestAmount && drift <= bestDrift)) {
      best = index;
      bestAmount = amount;
      bestDrift = drift;
    }
  }

  return best;
}

/**
 * The series of `cadence` that ends on slot `end`, built greedily backwards, cut to its longest
 * newest part where every plateau but the newest has two charges at least; null when too short.
 */
function seriesEndingAt(
  slots: ReadonlyArray<Slot>,
  used: ReadonlyArray<boolean>,
  end: number,
  cadence: Cadence,
): Found | null {
  const last = slots[end];

  if (last === undefined) {
    return null;
  }

  const indexes = [end];
  const plateaus: Array<Plateau> = [{ amountMinor: last.charge.amountMinor, count: 1 }];
  let current = last;

  for (;;) {
    const previous = previousOf(slots, used, current, cadence);
    const slot = previous === null ? undefined : slots[previous];
    const plateau = plateaus.at(-1);

    if (previous === null || slot === undefined || plateau === undefined) {
      break;
    }

    if (sameAmount(slot.charge.amountMinor, plateau.amountMinor)) {
      plateau.count += 1;
    } else if (plateaus.length > 1 && plateau.count < 2) {
      // An older plateau of one charge: no longer series holds it.
      break;
    } else {
      plateaus.push({ amountMinor: slot.charge.amountMinor, count: 1 });
    }

    indexes.push(previous);
    current = slot;
  }

  const oldest = plateaus.at(-1);

  if (plateaus.length > 1 && oldest !== undefined && oldest.count < 2) {
    plateaus.pop();
    indexes.pop();
  }

  if (indexes.length < MIN_CHARGES[cadence]) {
    return null;
  }

  return { cadence, indexes, plateaus };
}

/**
 * Whether another charge of the group, of the same price as one of its neighbours in the series,
 * falls between two consecutive charges of it. A baguette bought at one price several times a week
 * always has one a week or a month before: such a series is refused, though it also misses two
 * subscriptions at one price billed by one merchant on different days.
 */
function crowded(slots: ReadonlyArray<Slot>, indexes: ReadonlyArray<number>): boolean {
  for (let step = 1; step < indexes.length; step += 1) {
    const newer = slots[indexes[step - 1] ?? -1];
    const older = slots[indexes[step] ?? -1];

    if (newer === undefined || older === undefined) {
      continue;
    }

    for (let index = firstFrom(slots, older.at + 1); index < slots.length; index += 1) {
      const between = slots[index];

      if (between === undefined || between.at >= newer.at) {
        break;
      }

      const amount = between.charge.amountMinor;

      if (
        sameAmount(older.charge.amountMinor, amount) ||
        sameAmount(amount, newer.charge.amountMinor)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Whether the newest charge of a series alone at its price stands beside one that keeps the
 * series' price on the same step: then it is a one-off, not a new price, and the series ends on
 * the other (a purchase two days after a monthly charge is no price rise).
 */
function beside(slots: ReadonlyArray<Slot>, used: ReadonlyArray<boolean>, found: Found): boolean {
  const [newest] = found.plateaus;
  const end = found.indexes[0] ?? -1;
  const before = slots[found.indexes[1] ?? -1];

  if (newest === undefined || newest.count > 1 || before === undefined) {
    return false;
  }

  const tolerance = TOLERANCE_DAYS[found.cadence];
  const due = before.next[found.cadence];

  for (let index = firstFrom(slots, due - tolerance); index < slots.length; index += 1) {
    const slot = slots[index];

    if (slot === undefined || slot.at > due + tolerance) {
      break;
    }

    if (
      index !== end &&
      used[index] !== true &&
      slot.at > before.at &&
      sameAmount(before.charge.amountMinor, slot.charge.amountMinor)
    ) {
      return true;
    }
  }

  return false;
}

/** The first series of what is left of a group: each charge as an end, newest first, each cadence
 * shortest first. */
function firstSeries(slots: ReadonlyArray<Slot>, used: ReadonlyArray<boolean>): Found | null {
  for (let end = slots.length - 1; end >= 0; end -= 1) {
    if (used[end] === true) {
      continue;
    }

    for (const cadence of CADENCES) {
      const found = seriesEndingAt(slots, used, end, cadence);

      if (found !== null && !crowded(slots, found.indexes) && !beside(slots, used, found)) {
        return found;
      }
    }
  }

  return null;
}

/** The subscription a series found makes, as it stands on `asOf`. */
function subscriptionOf(
  slots: ReadonlyArray<Slot>,
  found: Found,
  asOf: string,
): Subscription | null {
  const charges = found.indexes.toReversed().flatMap((index) => {
    const slot = slots[index];

    return slot === undefined ? [] : [slot.charge];
  });

  const last = charges.at(-1);
  const [newest, previous] = found.plateaus;

  if (last === undefined || newest === undefined) {
    return null;
  }

  // A price charged once is not yet the usual one; it is a rise when above the one before.
  const alone = newest.count < 2 && previous !== undefined;
  const nextOn = nextDay(last.day, found.cadence);

  return {
    merchantId: last.merchantId,
    merchant: last.merchant,
    currency: last.currency,
    cadence: found.cadence,
    charges,
    usualMinor: alone ? previous.amountMinor : newest.amountMinor,
    lastOn: last.day,
    lastMinor: last.amountMinor,
    nextOn,
    priceRise:
      alone && newest.amountMinor > previous.amountMinor
        ? { fromMinor: previous.amountMinor, toMinor: newest.amountMinor }
        : null,
    stoppedOn: asOf > addDays(nextOn, TOLERANCE_DAYS[found.cadence]) ? nextOn : null,
  };
}

/** The subscriptions of one merchant in one currency. */
function subscriptionsOfGroup(charges: ReadonlyArray<Charge>, asOf: string): Array<Subscription> {
  const slots = charges
    .toSorted((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
    .map((charge) => ({
      charge,
      at: dayNumber(charge.day),
      next: {
        weekly: dayNumber(nextDay(charge.day, "weekly")),
        monthly: dayNumber(nextDay(charge.day, "monthly")),
        yearly: dayNumber(nextDay(charge.day, "yearly")),
      },
    }));

  const used = slots.map(() => false);
  const subscriptions: Array<Subscription> = [];

  while (subscriptions.length < SUBSCRIPTIONS_PER_MERCHANT) {
    const found = firstSeries(slots, used);

    if (found === null) {
      break;
    }

    for (const index of found.indexes) {
      used[index] = true;
    }

    const subscription = subscriptionOf(slots, found, asOf);

    if (subscription !== null) {
      subscriptions.push(subscription);
    }
  }

  return subscriptions;
}

/** By merchant name, then cadence, then what tells two of one merchant apart. */
function bySubscription(a: Subscription, b: Subscription): number {
  return (
    a.merchant.localeCompare(b.merchant) ||
    CADENCES.indexOf(a.cadence) - CADENCES.indexOf(b.cadence) ||
    a.merchantId.localeCompare(b.merchantId) ||
    a.currency.localeCompare(b.currency) ||
    a.lastOn.localeCompare(b.lastOn) ||
    (a.charges.at(-1)?.id ?? "").localeCompare(b.charges.at(-1)?.id ?? "")
  );
}

/**
 * The subscriptions among `charges`: expenses of known merchants, not dismissed, up to `asOf`.
 *
 * - Charges are grouped by merchant and currency.
 * - A series steps from each charge to the next by a week (±1 day), the same day of the next month
 *   (clamped to its last day, ±3 days) or of the next year (±7 days), measured from the previous
 *   charge; it has 4 weekly, 3 monthly or 2 yearly charges at least, never two on one day.
 * - Its amounts form plateaus of one price (within 2 % of the earlier amount, against the
 *   plateau's newest one so that a price cannot drift by small steps); every plateau but the
 *   newest has two charges at least, so that a bill that varies is never a subscription.
 * - Each charge, newest first, is tried as a series' end, each cadence shortest first; the series
 *   is built backwards, taking at each step the charge closest in amount. It is refused when a
 *   charge of the same price falls between two of its charges (a price often paid), or when its
 *   newest charge is alone at its price beside one that keeps the series' price (a one-off).
 * - Once a series is found, its charges are set aside and the rest searched again, three
 *   subscriptions at most per merchant and currency.
 *
 * Sorted by merchant name, then cadence; the same output whatever the order of `charges`.
 */
export function detectSubscriptions(
  charges: ReadonlyArray<Charge>,
  asOf: string,
): ReadonlyArray<Subscription> {
  const groups = new Map<string, Array<Charge>>();

  for (const charge of charges) {
    const key = JSON.stringify([charge.merchantId, charge.currency]);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [charge]);
    } else {
      group.push(charge);
    }
  }

  return [...groups.values()]
    .flatMap((group) => subscriptionsOfGroup(group, asOf))
    .sort(bySubscription);
}

/**
 * A month's subscriptions, as they stand on `asOf`: those that go on; those whose stop was seen in
 * the month, the day after their next day's tolerance falling between its first day and the
 * earlier of `asOf` and its last day; those that go on and rose with a charge of the month.
 */
export function subscriptionsOfMonth(
  subscriptions: ReadonlyArray<Subscription>,
  month: string,
  asOf: string,
): MonthSubscriptions {
  const first = `${month}-01`;
  const lastOfMonth = addDays(`${addMonths(month, 1)}-01`, -1);
  const until = asOf < lastOfMonth ? asOf : lastOfMonth;

  return {
    recurring: subscriptions.filter((each) => each.stoppedOn === null),
    stopped: subscriptions.filter((each) => {
      if (each.stoppedOn === null) {
        return false;
      }

      const seen = addDays(each.stoppedOn, TOLERANCE_DAYS[each.cadence] + 1);

      return first <= seen && seen <= until;
    }),
    rises: subscriptions.filter(
      (each) =>
        each.stoppedOn === null &&
        each.priceRise !== null &&
        each.lastOn.startsWith(first.slice(0, 8)),
    ),
  };
}

/**
 * The items of a calendar of subscriptions from `from` to `to`, both included: each charge paid on
 * those days, the one that rose marked so; the charges still due after `today`, from the next day
 * on, at the usual price, for those that go on; the day a stopped one was due. By day, then name.
 */
export function calendarDays(
  subscriptions: ReadonlyArray<Subscription>,
  from: string,
  to: string,
  today: string,
): ReadonlyArray<CalendarItem> {
  const items: Array<CalendarItem> = [];

  for (const subscription of subscriptions) {
    const { merchant, merchantId, currency, cadence, charges, priceRise } = subscription;
    const last = charges.at(-1);
    const series = `${merchantId}:${currency}:${cadence}:${charges[0]?.id ?? ""}`;

    const item = (id: string, day: string, kind: CalendarItem["kind"], minor: number) => ({
      id,
      day,
      kind,
      name: merchant,
      merchantId,
      amount: { minor, currency },
      priceRise:
        kind === "paid" && id === last?.id && priceRise !== null
          ? { beforeMinor: priceRise.fromMinor }
          : null,
    });

    for (const charge of charges) {
      if (from <= charge.day && charge.day <= to) {
        items.push(item(charge.id, charge.day, "paid", charge.amountMinor));
      }
    }

    if (subscription.stoppedOn !== null) {
      if (from <= subscription.stoppedOn && subscription.stoppedOn <= to) {
        items.push(
          item(
            `${series}:stopped:${subscription.stoppedOn}`,
            subscription.stoppedOn,
            "stopped",
            subscription.usualMinor,
          ),
        );
      }

      continue;
    }

    const dueMinor = priceRise === null ? subscription.usualMinor : priceRise.toMinor;

    for (let day = subscription.nextOn; day <= to; day = nextDay(day, cadence)) {
      if (day > today && day >= from) {
        // After a rise, the next charges are the new price: what the user will be charged.
        items.push(item(`${series}:due:${day}`, day, "due", dueMinor));
      }
    }
  }

  return items.sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}
