import { isKnownCurrency } from "@gousset/currency";
import { Schema } from "effect";

// The accounts' values the interface sends and checks, without the logic: the browser may import
// this file (`@gousset/core/account-values`) without bringing the database along.

/**
 * What the user picks when creating an account (issue #15), each stored as a kind and an envelope
 * (docs/data-model.md, "Kind and envelope are two columns"). A Livret A is a choice of its own,
 * savings with its envelope, so that one list of choices says it all.
 */
export const ACCOUNT_CHOICES = [
  "current",
  "savings",
  "livret_a",
  "card",
  "securities",
  "pea",
  "life_insurance",
  "loan",
  "benefit",
] as const;

export const AccountChoice = Schema.Literals(ACCOUNT_CHOICES);

export type AccountChoice = typeof AccountChoice.Type;

/** How an account behaves: the database's `account_kind`. */
export type AccountKind = "current" | "savings" | "card" | "investment" | "loan" | "benefit";

/** Which tax rules an account is under: the database's `account_envelope`. */
export type AccountEnvelope = "pea" | "life_insurance" | "livret_a" | "other";

/** `lines`: every line imported or entered; `balance`: a balance noted each month. */
export const AccountMode = Schema.Literals(["lines", "balance"]);

export type AccountMode = typeof AccountMode.Type;

/**
 * In which order a benefit account's credits are used up: `oldest_first`, by the day credited, or
 * `expiring_first`, by expiry date, as some issuers do (docs/data-model.md, "Accounts").
 */
export const CreditOrder = Schema.Literals(["oldest_first", "expiring_first"]);

export type CreditOrder = typeof CreditOrder.Type;

type Stored = { readonly kind: AccountKind; readonly envelope: AccountEnvelope | null };

const STORED = {
  current: { kind: "current", envelope: null },
  savings: { kind: "savings", envelope: null },
  livret_a: { kind: "savings", envelope: "livret_a" },
  card: { kind: "card", envelope: null },
  securities: { kind: "investment", envelope: null },
  pea: { kind: "investment", envelope: "pea" },
  life_insurance: { kind: "investment", envelope: "life_insurance" },
  loan: { kind: "loan", envelope: null },
  benefit: { kind: "benefit", envelope: null },
} as const satisfies { readonly [Choice in AccountChoice]: Stored };

/** The kind and envelope a choice is stored as. */
export function storedAs(choice: AccountChoice): Stored {
  return STORED[choice];
}

/**
 * The choice an account was made from. An envelope no choice gives (`other`, set by a later
 * milestone) reads as the plain choice of its kind.
 */
export function choiceOf(kind: AccountKind, envelope: AccountEnvelope | null): AccountChoice {
  switch (kind) {
    case "current":
    case "card":
    case "loan":
    case "benefit": {
      return kind;
    }

    case "savings": {
      return envelope === "livret_a" ? "livret_a" : "savings";
    }

    case "investment": {
      if (envelope === "pea" || envelope === "life_insurance") {
        return envelope;
      }

      return "securities";
    }
  }
}

/**
 * The groups of the accounts page, in their order (docs/data-model.md, "Accounts"). `invested` is
 * shown as "Savings and investments".
 */
export const ACCOUNT_GROUPS = ["available", "restricted", "invested", "owed"] as const;

export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

/** The group an account's kind puts it in. */
export function groupOf(kind: AccountKind): AccountGroup {
  switch (kind) {
    case "current":
    case "card": {
      return "available";
    }

    case "benefit": {
      return "restricted";
    }

    case "savings":
    case "investment": {
      return "invested";
    }

    case "loan": {
      return "owed";
    }
  }
}

/** A day that exists in the calendar. */
function isCalendarDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** `YYYY-MM-DD`, a day of the calendar: a bank's day, with no time and no time zone. */
export const Day = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, {
    message: "A day is written YYYY-MM-DD, as 2026-10-31.",
  }),
  Schema.makeFilter((day: string) => isCalendarDay(day), {
    message: "This day is not in the calendar: write an existing day, as 2026-10-31.",
  }),
);

/** An ISO 4217 code, upper case: `EUR`. */
export const Currency = Schema.String.check(
  Schema.isPattern(/^[A-Z]{3}$/, {
    message: "A currency is its ISO 4217 code, three capital letters, as EUR.",
  }),
);

/**
 * An account's currency: one of the ISO 4217 codes an account is opened in (`CURRENCY_CODES`), the
 * list the web form picks from, so that the MCP door refuses what the form never offers.
 */
export const AccountCurrency = Currency.check(
  Schema.makeFilter((currency: string) => isKnownCurrency(currency), {
    message:
      "This is not a currency an account is opened in: give its ISO 4217 code, as EUR, USD or JPY.",
  }),
);

/** An account's id, as the database makes them. */
export const AccountId = Schema.String.check(
  Schema.isUUID(undefined, { message: "An account is named by its id, a UUID." }),
);

/** An amount in minor units (cents for the euro): an integer, never a float. */
export const MinorAmount = Schema.Int;

/**
 * An account's settings, as the create and edit forms send them. `settlesIntoAccountId` is a card's
 * only, and a card needs it: the current account the card is debited from each month.
 */
export const AccountInput = Schema.Struct({
  name: Schema.Trim.check(Schema.isNonEmpty({ message: "An account needs a name." })),
  choice: AccountChoice,
  institution: Schema.optional(Schema.Trim),
  currency: AccountCurrency,
  mode: AccountMode,
  openingBalanceMinor: MinorAmount,
  openedOn: Schema.optional(Day),
  settlesIntoAccountId: Schema.optional(AccountId),
  /** Read for a benefit account only. Left out: `oldest_first` on create, unchanged on edit. */
  creditOrder: Schema.optional(CreditOrder),
});

export type AccountInput = typeof AccountInput.Type;

/** A line's id, as the database makes them. */
export const LineId = Schema.String.check(
  Schema.isUUID(undefined, { message: "A line is named by its id, a UUID." }),
);

/** The expiry of a benefit account's credit: a day, or null to take it away. */
export const CreditExpiryInput = Schema.Struct({
  lineId: LineId,
  expiresOn: Schema.NullOr(Day),
});

export type CreditExpiryInput = typeof CreditExpiryInput.Type;

/** A balance noted by hand on a balance-mode account: the balance at the end of `day`. */
export const NotedBalanceInput = Schema.Struct({
  accountId: AccountId,
  day: Day,
  balanceMinor: MinorAmount,
});

export type NotedBalanceInput = typeof NotedBalanceInput.Type;

/** The most days a chart of an account's balance covers at once. */
export const MAX_CHART_DAYS = 366;

/** The days a chart covers when none are asked for: the last 90, today included. */
export const DEFAULT_CHART_DAYS = 90;

/** The lines an account's page reads at once, newest first, unless asked for fewer or more. */
export const DEFAULT_LINES = 50;

/** The most lines read at once. */
export const MAX_LINES = 200;
