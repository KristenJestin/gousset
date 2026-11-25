import {
  accountNamed,
  closeAccount,
  createAccount,
  editAccount,
  listAccounts,
  noteBalance,
  reopenAccount,
  searchLines,
  setCreditExpiry,
  showAccount,
  today,
} from "@gousset/core";
import type {
  AccountCredit,
  AccountCredits,
  AccountDetail,
  AccountGroupList,
  AccountList,
  AccountNameAmbiguous,
  AccountNameUnknown,
  AccountRecord,
  AccountStore,
  AccountSummary,
  BalanceCategory,
  CategoryStore,
  LineRow,
  LineStore,
  Money,
  StatementCheck,
  StatementsUntil,
} from "@gousset/core";
import {
  ACCOUNT_CHOICES,
  AccountChoice,
  AccountCurrency,
  AccountInput,
  AccountMode,
  CreditOrder,
  DEFAULT_TOP_UP_DAYS,
  Day,
  LineId,
  MAX_TOP_UP_DAYS,
  choiceOf,
} from "@gousset/core/account-values";
import type { AccountGroup } from "@gousset/core/account-values";
import { minorDigits, readAmount } from "@gousset/import";
import { Cause, Effect, Exit, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { namedCategory, pathText } from "./categories";

/** The lines `show` gives when none are asked for, and the most it gives. */
const DEFAULT_LINES = 20;
const MAX_LINES = 100;

/** The credits of a benefit account `show` lists before saying how many more remain. */
const MAX_CREDITS = 30;

const AccountsInput = Schema.Struct({
  action: Schema.Literals([
    "list",
    "show",
    "create",
    "edit",
    "close",
    "reopen",
    "note_balance",
    "set_expiry",
  ]).annotate({
    description:
      "list: every account by group, with totals per currency. show: one account, its lines and its check against the statement. The others write: create, edit, close, reopen, note_balance (a balance-mode account's balance), set_expiry (a benefit credit's expiry).",
  }),
  name: Schema.optional(
    Schema.String.annotate({
      description:
        "The account's name, as list writes it (any case). create: the new account's name.",
    }),
  ),
  institution: Schema.optional(
    Schema.String.annotate({
      description:
        "The account's bank or issuer, when two accounts share the name. create: the new account's.",
    }),
  ),
  lines: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_LINES })).annotate({
      description: `show: how many of the last lines to give, 1 to ${MAX_LINES}; ${DEFAULT_LINES} if left out.`,
    }),
  ),
  before: Schema.optional(
    Schema.String.annotate({
      description:
        "show: an opaque handle to read lines older than the last page, exactly as the result gives it. Never made up.",
    }),
  ),
  kind: Schema.optional(
    AccountChoice.annotate({
      description:
        "create, edit: card is a deferred debit card; benefit holds restricted money (meal vouchers, gift cards).",
    }),
  ),
  currency: Schema.optional(
    AccountCurrency.annotate({
      description:
        "create, edit: an ISO 4217 code; EUR when left out on create. Fixed once the account has a line or a balance.",
    }),
  ),
  mode: Schema.optional(
    AccountMode.annotate({
      description:
        "create, edit: lines, kept by its imported lines (the default), or balance, a balance noted by hand (a loan, say).",
    }),
  ),
  opening_balance: Schema.optional(
    Schema.String.annotate({
      description:
        'create, edit: the balance before its first line, a decimal in its currency with a point for decimals ("-1,234.56"); 0 when left out on create.',
    }),
  ),
  opened_on: Schema.optional(
    Day.annotate({ description: "create, edit: the day it was opened, YYYY-MM-DD." }),
  ),
  settles_into: Schema.optional(
    Schema.String.annotate({
      description:
        "create, edit, a card only, which needs it: the name of the open current account it is debited from each month.",
    }),
  ),
  settles_into_institution: Schema.optional(
    Schema.String.annotate({
      description: "The bank of settles_into, when two accounts share its name.",
    }),
  ),
  credit_order: Schema.optional(
    CreditOrder.annotate({
      description:
        "create, edit, a benefit account: which credits are used first; oldest_first unless the issuer uses the soonest to expire first.",
    }),
  ),
  top_up_days: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_TOP_UP_DAYS })).annotate({
      description: `create, edit, a benefit account: the days, 0 to ${MAX_TOP_UP_DAYS}, its issuer takes to charge a purchase's rest to a bank card: a bank line naming the issuer that soon after a card line that used up the card or its cap joins that purchase as one expense, the lines already there too; ${DEFAULT_TOP_UP_DAYS} by default.`,
    }),
  ),
  top_up_cap: Schema.optional(
    Schema.String.annotate({
      description:
        'create, edit, a benefit account: the most it pays a day, a decimal; "" when unknown.',
    }),
  ),
  category: Schema.optional(
    Schema.String.annotate({
      description:
        'create, edit, an account kept by its balance: the category its movements go to, as categories list writes it ("Parent > Child" for a child); "" for none.',
    }),
  ),
  category_kind: Schema.optional(
    Schema.Literals(["expense", "income"]).annotate({
      description:
        "create, edit: the category's kind, when an expense and an income one share its name.",
    }),
  ),
  new_name: Schema.optional(
    Schema.String.annotate({ description: "edit: the account's new name." }),
  ),
  new_institution: Schema.optional(
    Schema.String.annotate({ description: 'edit: its new bank or issuer; "" removes it.' }),
  ),
  closed_on: Schema.optional(
    Day.annotate({ description: "close: the day it was closed, YYYY-MM-DD; today when left out." }),
  ),
  day: Schema.optional(
    Day.annotate({
      description: "note_balance: the day the balance is at the end of; today when left out.",
    }),
  ),
  balance: Schema.optional(
    Schema.String.annotate({
      description:
        'note_balance: the balance, a decimal in the account\'s currency ("-149,500.00").',
    }),
  ),
  line: Schema.optional(
    Schema.String.annotate({
      description: "set_expiry: the credit's line handle, as lines search gives it.",
    }),
  ),
  expires_on: Schema.optional(
    Schema.String.annotate({
      description:
        'set_expiry: the day the credit expires, YYYY-MM-DD, or "" to take its expiry away.',
    }),
  ),
});

type AccountsInput = typeof AccountsInput.Type;

const DESCRIPTION = `The user's accounts: read them, and create and change them as Gousset's accounts page does. \`list\`: every account by group (available, restricted, savings and investments, owed) with its balance today and how far its statements go, each group's totals per currency (never converted), closed accounts apart. \`show\`: one account's balance, its last lines newest first with the balance after each (\`lines\`, 1 to ${MAX_LINES}, ${DEFAULT_LINES} by default; the result writes the call to read older ones), the check against its latest statement balance, and a benefit account's credits: order of use, what is left, what expires when.

Use \`list\` for "how much do I have, and where?", \`show\` for "does my balance match my bank's?" or "what expires when on my meal vouchers?", the writes to set the user's accounts up.

Writes need a connection allowed to write. \`create\` needs \`name\` and \`kind\`, and is not idempotent: a repeat makes a second account, so list first. \`edit\` changes only what it is given. \`close\` keeps the lines and leaves the totals; \`reopen\` undoes it. \`note_balance\`: the balance of an account kept by a noted balance (\`mode\` balance), one a day; it makes the day's movement line, in its \`category\`. \`set_expiry\`: when a benefit credit expires, by its handle from the \`lines\` tool.

Name an account by \`name\`, as \`list\` writes it (any case), with \`institution\` when two share it. Amounts are decimal strings in the account's currency. Refused, saying what to do: an unknown or ambiguous name, a currency off ISO 4217's list, a card without \`settles_into\` (its current account) or another kind with one, a new currency once the account has lines, closing a closed account, a balance on an account kept by its lines or twice on a day, an expiry before its credit.

Examples: {"action":"show","name":"Livret A","institution":"Riverside Bank"} · {"action":"create","name":"Deferred card","kind":"card","settles_into":"Current account","opening_balance":"-120.40"} · {"action":"note_balance","name":"Mortgage","day":"2026-10-31","balance":"-149500"}`;

/** `1,234.56 EUR`, with the currency's own minor units (`1,235 JPY`, `1.235 KWD`). */
export function amount(money: Money): string {
  const digits = minorDigits(money.currency);

  const units = (money.minor / 10 ** digits).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return `${units} ${money.currency}`;
}

const GROUP_TITLES = {
  available: "Available",
  restricted: "Restricted",
  invested: "Savings and investments",
  owed: "Owed",
} as const satisfies { readonly [Group in AccountGroup]: string };

const CHOICE_NAMES = {
  current: "current account",
  savings: "savings account",
  livret_a: "Livret A",
  card: "deferred debit card",
  securities: "securities account",
  pea: "PEA",
  life_insurance: "life insurance",
  loan: "loan",
  benefit: "benefit account",
} as const satisfies { readonly [Choice in AccountChoice]: string };

/** `Livret A (Riverside Bank)`: names are not unique, the institution tells them apart. */
export function named(account: {
  readonly name: string;
  readonly institution: string | null;
}): string {
  return account.institution === null ? account.name : `${account.name} (${account.institution})`;
}

function statementsText(until: StatementsUntil | null): string {
  if (until === null) {
    return "no statement yet";
  }

  return until.from === "import"
    ? `statements until ${until.day}`
    : `last statement balance on ${until.day}`;
}

function totalsText(totals: ReadonlyArray<Money>): string {
  if (totals.length === 1) {
    return `Total: ${totals.map(amount).join("")}`;
  }

  return `Totals per currency, not converted: ${totals.map(amount).join("; ")}`;
}

function summaryLine(account: AccountSummary): string {
  const kept = account.mode === "balance" ? ", kept by a noted balance" : "";

  return `- ${named(account)}, ${CHOICE_NAMES[account.choice]}${kept}: ${amount(account.balance)}; ${statementsText(account.statementsUntil)}.`;
}

function groupText(group: AccountGroupList): string {
  const title = GROUP_TITLES[group.group];

  if (group.accounts.length === 0) {
    return `${title}: no account.`;
  }

  return [`${title}:`, ...group.accounts.map(summaryLine), totalsText(group.totals)].join("\n");
}

/** The accounts page, in Gousset's words: the groups in order, then the closed accounts. */
function listText(list: AccountList): string {
  const opened = list.groups.flatMap((group) => group.accounts).length;

  if (opened === 0 && list.closed.length === 0) {
    return "The user has no account in Gousset yet.";
  }

  const closed =
    list.closed.length === 0
      ? []
      : [
          [
            "Closed accounts, out of the totals:",
            ...list.closed.map(
              (account) =>
                `- ${named(account)}, ${CHOICE_NAMES[account.choice]}, closed on ${account.closedOn ?? ""}: ${amount(account.balance)}.`,
            ),
          ].join("\n"),
        ];

  return [
    `The user's accounts, balances at the end of ${list.day}.`,
    ...list.groups.map(groupText),
    ...closed,
  ].join("\n\n");
}

function mismatchLine(mismatch: {
  readonly day: string;
  readonly statement: Money;
  readonly app: Money;
}): string {
  const way = mismatch.app.minor - mismatch.statement.minor > 0 ? "more" : "less";

  return `- ${mismatch.day}: the statement said ${amount(mismatch.statement)}, Gousset counted ${amount(mismatch.app)} (Gousset counts ${way}).`;
}

function headlineText(check: StatementCheck): string {
  if (check.agrees) {
    return `Check: on ${check.day} the statement and Gousset agree, both ${amount(check.statement)}.`;
  }

  const way = check.difference.minor > 0 ? "more" : "less";

  return `Check: on ${check.day} they disagree. The statement says ${amount(check.statement)}, Gousset counts ${amount(check.app)}: a difference of ${amount(check.difference)} (Gousset counts ${way}). A line may be missing, held as a near duplicate, or the opening balance may be wrong.`;
}

function checkText(detail: AccountDetail): string {
  const { check } = detail;

  if (check === null) {
    return "Check: no statement gave a balance yet, so there is nothing to check against.";
  }

  if (check.earlierMismatches.length === 0) {
    return headlineText(check);
  }

  return [
    headlineText(check),
    [
      "Also differs on these earlier statements:",
      ...check.earlierMismatches.map(mismatchLine),
    ].join("\n"),
  ].join("\n");
}

/** What a movement line is named: it has no label of its own (#31). */
export const MOVEMENT = "movement of the noted balance";

const OTHER_KIND = { expense: "income", income: "expense" } as const;

/** Where the movements of an account kept by its balance go, as its page says. */
function movementsText(category: BalanceCategory | null): string {
  const made =
    "Each noted balance makes one line, its movement: the noted balance less the one before and less the account's other lines booked between them.";

  if (category === null) {
    return `${made} No category is chosen for them: each goes to its kind's fallback.`;
  }

  if (category.archived) {
    return `${made} Their category, ${category.name} (${category.kind}), is archived: a new one goes to its kind's fallback.`;
  }

  const other = OTHER_KIND[category.kind];

  return `${made} One that is an ${category.kind} goes to ${category.name}; one that is an ${other} goes to the ${other} fallback.`;
}

/** One account's page, in Gousset's words: balance, check, then the last lines. */
function showText(detail: AccountDetail, linesCount: number): string {
  const { account } = detail;

  const kept =
    account.mode === "balance" ? "kept by a balance noted each month" : "kept by its lines";

  const movements = account.mode === "balance" ? [movementsText(account.balanceCategory)] : [];

  const closed = account.closedOn === null ? "" : ` Closed on ${account.closedOn}.`;

  const settles =
    account.settlesInto === null ? [] : [`Debited each month from: ${account.settlesInto.name}.`];

  const credits = creditsText(detail);

  const lines =
    detail.lines.length === 0
      ? ["No line yet."]
      : [
          `Last ${detail.lines.length} line(s), newest first (booked on, amount, balance after, label):`,
          ...detail.lines.map((line) => {
            const after =
              line.balanceAfter === null ? "" : `, balance ${amount(line.balanceAfter)}`;

            const expiry =
              line.expiresOn === null ? "" : `, ${expiryText(line.expiresOn, detail.day)}`;

            const label = line.fromBalance
              ? MOVEMENT
              : line.label === ""
                ? "(no label)"
                : line.label;

            return `- ${line.bookedOn}: ${amount(line.amount)}${after}, ${label}${expiry}`;
          }),
        ];

  const older =
    detail.olderBefore === null
      ? []
      : [
          `Older lines remain. Read them with: ${call({
            action: "show",
            name: account.name,
            institution: account.institution ?? undefined,
            lines: linesCount,
            before: detail.olderBefore,
          })}`,
        ];

  return [
    [
      `${named(account)}, ${CHOICE_NAMES[account.choice]} in ${account.currency}, ${kept}.${closed}`,
      `Balance at the end of ${detail.day}: ${amount(detail.balance)}; ${statementsText(account.statementsUntil)}.`,
      `Money in this month so far: ${amount(detail.monthIn)}; out: ${amount(detail.monthOut)}.`,
      ...settles,
      ...movements,
    ].join("\n"),
    checkText(detail),
    ...(credits === null ? [] : [credits]),
    [...lines, ...older].join("\n"),
  ].join("\n\n");
}

const ORDER_TEXT = {
  oldest_first: "Credits are used oldest first.",
  expiring_first: "Credits are used soonest expiry first, as the issuer does.",
} as const satisfies { readonly [Order in AccountCredits["order"]]: string };

/** A benefit account's top-ups (#28): within how many days, and its daily cap. */
function topUpText(days: number, cap: Money | null): string {
  const within = days === 0 ? "the same day" : `within ${days} day${days === 1 ? "" : "s"}`;
  const most = cap === null ? "no daily cap known" : `a daily cap of ${amount(cap)}`;

  return `Top-ups: the rest charged by its issuer to a bank card ${within} joins the purchase; ${most}.`;
}

/** A credit's expiry as of `today`: an expired credit still counts until a line takes it out. */
function expiryText(expiresOn: string, today: string): string {
  return expiresOn < today
    ? `expired on ${expiresOn} and still counted`
    : `expires on ${expiresOn}`;
}

function creditLine(credit: AccountCredit, today: string): string {
  const which =
    credit.creditedOn === null
      ? "the opening balance"
      : `credited on ${credit.creditedOn}, ${credit.label === null || credit.label === "" ? "(no label)" : credit.label}`;

  const expiry = credit.expiresOn === null ? "no expiry" : expiryText(credit.expiresOn, today);

  return `- ${which}: ${amount(credit.left)} left of ${amount(credit.amount)}, ${expiry}.`;
}

/** The credits past the first `MAX_CREDITS`: how many, and what they hold, in one line. */
function moreCreditsLine(rest: ReadonlyArray<AccountCredit>): string {
  const [first] = rest;

  if (first === undefined) {
    return "";
  }

  const left = {
    minor: rest.reduce((total, credit) => total + credit.left.minor, 0),
    currency: first.left.currency,
  };

  return `and ${rest.length} more credits, used after these, ${amount(left)} left in all; "What expires when" counts them all.`;
}

/** A benefit account's credits, in Gousset's words; null for every other account. */
function creditsText(detail: AccountDetail): string | null {
  if (detail.account.kind !== "benefit") {
    return null;
  }

  const { credits } = detail;

  if (credits === null) {
    return "Benefit account kept by its balance: its balance is restricted, not counted in the money available. Credits and their expiries are not followed in balance mode.";
  }

  const expiring =
    credits.expiring.length === 0
      ? ["What expires when: no credit left has an expiry."]
      : [
          "What expires when:",
          ...credits.expiring.map((each) =>
            each.day < detail.day
              ? `- ${each.day}: ${amount(each.amount)} expired on that day; it still counts until a line takes it out.`
              : `- ${each.day}: ${amount(each.amount)} expires.`,
          ),
        ];

  const rest = credits.open.slice(MAX_CREDITS);

  const open =
    credits.open.length === 0
      ? ["No credit has anything left."]
      : [
          "Credits left, in order of use:",
          ...credits.open.slice(0, MAX_CREDITS).map((credit) => creditLine(credit, detail.day)),
          ...(rest.length > 0 ? [moreCreditsLine(rest)] : []),
        ];

  const uncovered =
    credits.uncovered.minor > 0
      ? [
          `Spent beyond every credit so far: ${amount(credits.uncovered)}, taken from the next credit.`,
        ]
      : [];

  return [
    "Benefit account: its money is restricted, not counted in the money available.",
    ORDER_TEXT[credits.order],
    ...expiring,
    ...open,
    ...uncovered,
  ].join("\n");
}

const call = (input: typeof AccountsInput.Encoded) => `accounts ${JSON.stringify(input)}`;

const LIST = call({ action: "list" });

/**
 * The account a write of another tool names (`lines pair`, #31), or the refusal to give: the user's
 * accounts to choose from, or, when two share the name, `again`, the same call naming the first.
 */
export function accountToWrite(
  owner: string,
  name: string,
  institution: string | undefined,
  again: (account: { readonly name: string; readonly institution: string | null }) => string,
) {
  return accountNamed(owner, name, institution).pipe(
    Effect.catchTags({
      AccountNameUnknown: (unknown) =>
        Effect.fail(
          new ToolRefusal({
            message:
              unknown.accounts.length === 0
                ? "The user has no account in Gousset yet."
                : `No account of the user's is named "${unknown.name}"${institution === undefined ? "" : ` at "${institution}"`}. Their accounts: ${unknown.accounts.map(named).join(", ")}. Name one of these, as accounts list writes it, which also says which are kept by a noted balance.`,
            example: LIST,
          }),
        ),
      AccountNameAmbiguous: (ambiguous) => {
        const [first] = ambiguous.matches;
        const institutions = new Set(ambiguous.matches.map((match) => match.institution));

        const apart =
          institutions.size === ambiguous.matches.length
            ? "Add institution to tell them apart."
            : "Some share their institution too, so a name cannot tell them apart: ask the user to rename one in Gousset.";

        return Effect.fail(
          new ToolRefusal({
            message: `Several accounts of the user's are named "${ambiguous.name}": ${ambiguous.matches.map(named).join(", ")}. ${apart}`,
            example: again(first ?? { name: ambiguous.name, institution: null }),
          }),
        );
      },
    }),
  );
}

/** The lines of one account and one day a search reads to find its movement among them. */
const DAY_LINES = 100;

/** The movement line a noted balance made, in Gousset's words; `search` reads it otherwise. */
function movementText(movement: LineRow | undefined, search: string): string {
  if (movement === undefined) {
    return `Gousset makes its movement, a line of that day: read it with ${search}`;
  }

  if (movement.amount.minor === 0) {
    return "No movement: the noted balance is the one before plus the account's other lines booked between them.";
  }

  const category =
    movement.category === null
      ? ""
      : `, an ${movement.category.kind} in ${pathText(movement.category)}`;

  return `Its movement, the line Gousset made of it: ${amount(movement.amount)}${category}. It is the noted balance less the one before (or the opening balance) and less the account's other lines booked between them, such as transfers.`;
}

type Encoded = typeof AccountsInput.Encoded;

type Named = { readonly name: string; readonly institution: string | null };

/** The name and institution a call names an account by. */
const namedBy = (account: Named) => ({
  name: account.name,
  institution: account.institution ?? undefined,
});

const refuse = (message: string, example: Encoded) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

/** A name no account of the user's has: their accounts, and the call again with the first. */
function unknownName(
  unknown: AccountNameUnknown,
  institution: string | undefined,
  action: string,
  retry: (account: Named) => Encoded,
): ToolRefusal {
  const [first] = unknown.accounts;

  if (first === undefined) {
    return new ToolRefusal({
      message: "The user has no account in Gousset yet: create one first.",
      example: call({ action: "list" }),
    });
  }

  const at = institution === undefined ? "" : ` at "${institution}"`;

  return new ToolRefusal({
    message: `No account of the user's is named "${unknown.name}"${at}. Their accounts: ${unknown.accounts.map(named).join(", ")}. Call ${action} again with one of these names.`,
    example: call(retry(first)),
  });
}

/** A name several accounts share: them, and whether their institutions tell them apart. */
function ambiguousName(
  ambiguous: AccountNameAmbiguous,
  retry: (account: Named) => Encoded,
): ToolRefusal {
  const [first] = ambiguous.matches;
  const institutions = new Set(ambiguous.matches.map((match) => match.institution));

  const apart =
    institutions.size === ambiguous.matches.length
      ? "Add institution to tell them apart."
      : "Some share their institution too, so a name cannot tell them apart: ask the user to rename one in Gousset.";

  return new ToolRefusal({
    message: `Several accounts of the user's are named "${ambiguous.name}": ${ambiguous.matches.map(named).join(", ")}. ${apart}`,
    example: call(retry(first ?? { name: ambiguous.name, institution: null })),
  });
}

/**
 * The account a call names, by name and institution; a name that names none or several is refused
 * with the names to choose from and `retry`, the call again for one of them.
 */
const accountOf = (
  owner: string,
  name: string,
  institution: string | undefined,
  action: string,
  retry: (account: Named) => Encoded,
) =>
  accountNamed(owner, name, institution).pipe(
    Effect.catchTags({
      AccountNameUnknown: (unknown) =>
        Effect.fail(unknownName(unknown, institution, action, retry)),
      AccountNameAmbiguous: (ambiguous) => Effect.fail(ambiguousName(ambiguous, retry)),
      // A failure of the database is Gousset's, not the caller's: the door says so.
      QueryFailed: Effect.die,
    }),
  );

/** Found by name a moment before, then deleted: as good as unknown. */
const gone = (name: string) =>
  refuse(`The account "${name}" is gone. List the accounts again.`, { action: "list" });

/** An amount written by the caller, in minor units of `currency`. */
const minorOf = (field: string, written: string, currency: string, example: Encoded) =>
  readAmount({ field, text: written, line: 0 }, currency, "decimal-point").pipe(
    Effect.catchTag("InvalidField", (invalid) =>
      refuse(
        `${field} must be ${invalid.expected}, a decimal in ${currency} with a point for decimals; "${invalid.text}" is not.`,
        example,
      ),
    ),
  );

/** A benefit account's daily cap: left out, unchanged; "", unknown; otherwise its minor units. */
const topUpCapOf = (input: AccountsInput, currency: string, retry: Encoded) =>
  input.top_up_cap === undefined
    ? Effect.succeed(undefined)
    : input.top_up_cap.trim() === ""
      ? Effect.succeed(null)
      : minorOf("top_up_cap", input.top_up_cap, currency, {
          ...retry,
          top_up_cap: minorDigits(currency) === 0 ? "2,500" : "25.00",
        });

/** An amount a currency can hold, for the example of a refusal: JPY has no decimals. */
const sampleAmount = (currency: string) => (minorDigits(currency) === 0 ? "-1,234" : "-1,234.56");

const decodeSettings = Schema.decodeUnknownExit(AccountInput);

/** An account's settings, checked as the web form's are (core's `AccountInput`). */
function settingsOf(
  settings: typeof AccountInput.Encoded,
  example: Encoded,
): Effect.Effect<AccountInput, ToolRefusal> {
  const decoded = decodeSettings(settings);

  if (Exit.isSuccess(decoded)) {
    return Effect.succeed(decoded.value);
  }

  const issue = Cause.squash(decoded.cause);

  return Effect.fail(
    new ToolRefusal({
      message: `These settings are not valid: ${issue instanceof Error ? issue.message : "they do not match an account's"}.`,
      example: call(example),
    }),
  );
}

/** A card's current account, by the name `settles_into` gives; none when it gives none. */
const settlesIntoOf = (owner: string, input: AccountsInput, retry: Encoded) =>
  input.settles_into === undefined
    ? Effect.succeed(undefined)
    : Effect.map(
        accountOf(
          owner,
          input.settles_into,
          input.settles_into_institution,
          retry.action,
          (account) => ({
            ...retry,
            settles_into: account.name,
            settles_into_institution: account.institution ?? undefined,
          }),
        ),
        (account) => account.id,
      );

/**
 * The category an account kept by its balance sends its movements to, by the name `category` gives:
 * undefined when it gives none (an edit keeps the account's), null for "" (none).
 */
const balanceCategoryOf = (owner: string, input: AccountsInput, retry: Encoded) => {
  const written = input.category;

  if (written === undefined) {
    return Effect.succeed(undefined);
  }

  if (written.trim() === "") {
    return Effect.succeed(null);
  }

  return Effect.map(
    namedCategory(owner, written, input.category_kind, (name, kind) =>
      call({ ...retry, category: name, category_kind: kind }),
    ),
    (found) => found.id,
  );
};

/** A category `balanceCategoryOf` found, then gone or archived when the account was written. */
const categoryRefused = (reason: "unknown" | "archived", retry: Encoded) =>
  refuse(
    reason === "archived"
      ? `The category "${retry.category ?? ""}" is archived: choose another for the account's movements, or restore it with categories first.`
      : `The category "${retry.category ?? ""}" is gone. List the categories again and name one of them.`,
    { ...retry, category: "" },
  );

const SETTLEMENT_REFUSALS = {
  required:
    "A card needs settles_into: the name of the open current account it is debited from each month.",
  only_a_card:
    "Only a card is debited from a current account: leave settles_into out, or make the account a card (kind card).",
  not_open_current:
    "settles_into must be one of the user's open current accounts, and not the card itself.",
} as const;

const CARD_EXAMPLE: Encoded = {
  action: "create",
  name: "Deferred card",
  kind: "card",
  settles_into: "Current account",
};

/** An account's settings after a write, read back: what the caller can check it did. */
function settingsText(detail: AccountDetail): string {
  const { account } = detail;

  const kept =
    account.mode === "balance" ? "kept by a balance noted each month" : "kept by its lines";

  const closed = account.closedOn === null ? "" : ` Closed on ${account.closedOn}.`;
  const opened = account.openedOn === null ? "" : `, opened on ${account.openedOn}`;

  return [
    `${named(account)}, ${CHOICE_NAMES[account.choice]} in ${account.currency}, ${kept}.${closed}`,
    `Opening balance: ${amount(account.openingBalance)}${opened}.`,
    ...(account.settlesInto === null
      ? []
      : [`Debited each month from: ${account.settlesInto.name}.`]),
    ...(account.kind === "benefit"
      ? [ORDER_TEXT[account.creditOrder], topUpText(account.topUpDays, account.topUpCap)]
      : []),
    ...(account.mode === "balance" ? [movementsText(account.balanceCategory)] : []),
    `Balance at the end of ${detail.day}: ${amount(detail.balance)}; ${statementsText(account.statementsUntil)}.`,
  ].join("\n");
}

/** What a write on an account answers: what it did, the account's settings now, and how to read it. */
const writtenText = (owner: string, accountId: string, done: string) =>
  showAccount(owner, accountId, { limit: 1 }).pipe(
    Effect.map((detail) =>
      [
        done,
        settingsText(detail),
        `Read it with: ${call({ action: "show", ...namedBy(detail.account) })}`,
      ].join("\n\n"),
    ),
    // Written a moment before: an account deleted in between, or a failure, is Gousset's.
    Effect.catchTags({
      AccountNotFound: Effect.die,
      DayRangeRefused: Effect.die,
      QueryFailed: Effect.die,
    }),
  );

const show = (owner: string, input: AccountsInput) => {
  const { name } = input;

  if (name === undefined) {
    return refuse("show needs the account's name, as list writes it.", {
      action: "show",
      name: "Current account",
    });
  }

  const linesCount = input.lines ?? DEFAULT_LINES;

  return Effect.gen(function* () {
    const found = yield* accountOf(owner, name, input.institution, "show", (account) => ({
      action: "show",
      ...namedBy(account),
    }));

    return showText(
      yield* showAccount(owner, found.id, { limit: linesCount, before: input.before }),
      linesCount,
    );
  }).pipe(
    Effect.catchTags({
      AccountNotFound: () => gone(name),
      // The default days always make a valid range.
      DayRangeRefused: Effect.die,
      QueryFailed: Effect.die,
    }),
  );
};

const create = (owner: string, input: AccountsInput) =>
  Effect.gen(function* () {
    const { name, kind } = input;

    if (name === undefined || kind === undefined) {
      return yield* refuse(
        `create needs name and kind (${ACCOUNT_CHOICES.join(", ")}); the other settings have defaults.`,
        { action: "create", name: "Livret A", kind: "livret_a", institution: "Riverside Bank" },
      );
    }

    const retry: Encoded = { action: "create", name, kind, institution: input.institution };
    const currency = input.currency ?? "EUR";

    const openingBalanceMinor =
      input.opening_balance === undefined
        ? 0
        : yield* minorOf("opening_balance", input.opening_balance, currency, {
            ...retry,
            currency,
            opening_balance: sampleAmount(currency),
          });

    const settings = yield* settingsOf(
      {
        name,
        choice: kind,
        institution: input.institution,
        currency,
        mode: input.mode ?? "lines",
        openingBalanceMinor,
        openedOn: input.opened_on,
        settlesIntoAccountId: yield* settlesIntoOf(owner, input, retry),
        creditOrder: input.credit_order,
        balanceCategoryId: yield* balanceCategoryOf(owner, input, retry),
        topUpDays: input.top_up_days,
        topUpCapMinor: yield* topUpCapOf(input, currency, retry),
      },
      retry,
    );

    const created = yield* createAccount(owner, settings).pipe(
      Effect.catchTags({
        SettlementRefused: (refusal) =>
          refuse(
            SETTLEMENT_REFUSALS[refusal.reason],
            refusal.reason === "only_a_card" ? retry : { ...CARD_EXAMPLE, name },
          ),
        BalanceCategoryRefused: (refusal) =>
          categoryRefused(refusal.reason, { ...retry, category: input.category }),
        QueryFailed: Effect.die,
      }),
    );

    return yield* writtenText(owner, created.id, `Created ${named(created)}.`);
  });

/** Whether an edit gives something to change. */
const changesSomething = (input: AccountsInput) =>
  [
    input.kind,
    input.currency,
    input.mode,
    input.opening_balance,
    input.opened_on,
    input.settles_into,
    input.credit_order,
    input.top_up_days,
    input.top_up_cap,
    input.category,
    input.new_name,
    input.new_institution,
  ].some((value) => value !== undefined);

/** The settings an edit leaves as they are, as the edit form sends them back with the rest. */
const edit = (owner: string, input: AccountsInput) =>
  Effect.gen(function* () {
    const { name } = input;

    if (name === undefined || !changesSomething(input)) {
      return yield* refuse(
        "edit needs the account's name, as list writes it, and what to change: kind, currency, mode, opening_balance, opened_on, settles_into, credit_order, top_up_days, top_up_cap, category, new_name or new_institution.",
        { action: "edit", name: name ?? "Current account", new_name: "Everyday account" },
      );
    }

    const found: AccountRecord = yield* accountOf(
      owner,
      name,
      input.institution,
      "edit",
      (account) => ({ ...input, ...namedBy(account) }),
    );

    const retry: Encoded = { ...input, ...namedBy(found) };
    const choice = input.kind ?? choiceOf(found.kind, found.envelope);
    const currency = input.currency ?? found.currency;

    // The stored opening balance is minor units: in a currency with other digits it would read
    // as another amount (12,345 for 123.45 EUR in JPY), so the edit must say it anew.
    if (
      input.opening_balance === undefined &&
      found.openingBalanceMinor !== 0 &&
      minorDigits(currency) !== minorDigits(found.currency)
    ) {
      return yield* refuse(
        `The opening balance of ${named(found)} is ${amount({ minor: found.openingBalanceMinor, currency: found.currency })}, and ${currency} has other decimals: give opening_balance in ${currency} with the new currency.`,
        { ...retry, opening_balance: sampleAmount(currency) },
      );
    }

    // The daily cap is minor units too (#28): the same holds for it.
    if (
      input.top_up_cap === undefined &&
      found.topUpCapMinor !== null &&
      minorDigits(currency) !== minorDigits(found.currency)
    ) {
      return yield* refuse(
        `The daily cap of ${named(found)} is ${amount({ minor: found.topUpCapMinor, currency: found.currency })}, and ${currency} has other decimals: give top_up_cap in ${currency} with the new currency, or "" for none.`,
        { ...retry, top_up_cap: minorDigits(currency) === 0 ? "2,500" : "25.00" },
      );
    }

    const openingBalanceMinor =
      input.opening_balance === undefined
        ? found.openingBalanceMinor
        : yield* minorOf("opening_balance", input.opening_balance, currency, {
            ...retry,
            opening_balance: sampleAmount(currency),
          });

    // A card keeps its current account unless the edit names another; any other kind has none.
    const kept = choice === "card" ? (found.settlesIntoAccountId ?? undefined) : undefined;
    const settlesInto = (yield* settlesIntoOf(owner, input, retry)) ?? kept;

    const settings = yield* settingsOf(
      {
        name: input.new_name ?? found.name,
        choice,
        institution: input.new_institution ?? found.institution ?? undefined,
        currency,
        mode: input.mode ?? found.mode,
        openingBalanceMinor,
        openedOn: input.opened_on ?? found.openedOn ?? undefined,
        settlesIntoAccountId: settlesInto,
        creditOrder: input.credit_order,
        // Left out, the account keeps its category (#31), its top-up days and cap (#28).
        balanceCategoryId: yield* balanceCategoryOf(owner, input, retry),
        topUpDays: input.top_up_days,
        topUpCapMinor: yield* topUpCapOf(input, currency, retry),
      },
      retry,
    );

    yield* editAccount(owner, found.id, settings).pipe(
      Effect.catchTags({
        AccountNotFound: () => gone(name),
        CurrencyLocked: () =>
          refuse(
            `The currency of ${named(found)} cannot change: it has lines or balances, whose amounts would change meaning. Create another account in ${currency} instead.`,
            { action: "create", name: found.name, kind: choice, currency },
          ),
        SettlementRefused: (refusal) =>
          refuse(
            SETTLEMENT_REFUSALS[refusal.reason],
            refusal.reason === "only_a_card"
              ? { action: "edit", ...namedBy(found), kind: "card", settles_into: "Current account" }
              : { action: "edit", ...namedBy(found), settles_into: "Current account" },
          ),
        BalanceCategoryRefused: (refusal) => categoryRefused(refusal.reason, retry),
        QueryFailed: Effect.die,
      }),
    );

    return yield* writtenText(owner, found.id, `Saved the changes to ${named(found)}.`);
  });

/** The account a call that needs only a name acts on. */
const namedAccount = (owner: string, input: AccountsInput, action: "close" | "reopen") =>
  input.name === undefined
    ? refuse(`${action} needs the account's name, as list writes it.`, {
        action,
        name: "Old savings",
      })
    : accountOf(owner, input.name, input.institution, action, (account) => ({
        action,
        ...namedBy(account),
      }));

const close = (owner: string, input: AccountsInput) =>
  Effect.gen(function* () {
    const found = yield* namedAccount(owner, input, "close");
    const closedOn = input.closed_on ?? (yield* today);

    yield* closeAccount(owner, found.id, closedOn).pipe(
      Effect.catchTags({
        AccountNotFound: () => gone(found.name),
        AccountAlreadyClosed: (closed) =>
          refuse(
            `${named(found)} is closed already, since ${closed.closedOn}. To close it on another day, reopen it first.`,
            { action: "reopen", ...namedBy(found) },
          ),
        QueryFailed: Effect.die,
      }),
    );

    return yield* writtenText(
      owner,
      found.id,
      `Closed ${named(found)} on ${closedOn}: it keeps its lines and leaves the totals.`,
    );
  });

const reopen = (owner: string, input: AccountsInput) =>
  Effect.gen(function* () {
    const found = yield* namedAccount(owner, input, "reopen");

    yield* reopenAccount(owner, found.id).pipe(
      Effect.catchTags({
        AccountNotFound: () => gone(found.name),
        AccountNotClosed: () =>
          refuse(`${named(found)} is open: there is nothing to reopen.`, {
            action: "close",
            ...namedBy(found),
          }),
        QueryFailed: Effect.die,
      }),
    );

    return yield* writtenText(
      owner,
      found.id,
      `Reopened ${named(found)}: it counts in the totals again.`,
    );
  });

const NOTE_EXAMPLE: Encoded = {
  action: "note_balance",
  name: "Mortgage",
  day: "2026-10-31",
  balance: "-149,500.00",
};

const note = (owner: string, input: AccountsInput) =>
  Effect.gen(function* () {
    const { name, balance } = input;

    if (name === undefined || balance === undefined) {
      return yield* refuse(
        "note_balance needs the account's name and its balance, a decimal in its currency; day is today when left out.",
        NOTE_EXAMPLE,
      );
    }

    const found = yield* accountOf(owner, name, input.institution, "note_balance", (account) => ({
      ...input,
      ...namedBy(account),
    }));

    const day = input.day ?? (yield* today);
    const retry: Encoded = { ...input, ...namedBy(found), day };

    const minor = yield* minorOf("balance", balance, found.currency, {
      ...retry,
      balance: sampleAmount(found.currency),
    });

    yield* noteBalance(owner, found.id, day, minor).pipe(
      Effect.catchTags({
        AccountNotFound: () => gone(name),
        AccountKeptByLines: () =>
          refuse(
            `${named(found)} is kept by its lines: its balance comes from them, and a balance is noted only on an account kept by a noted balance. Import its statement instead, or edit it to mode balance.`,
            { action: "edit", ...namedBy(found), mode: "balance" },
          ),
        BalanceAlreadyNoted: () =>
          refuse(
            `${named(found)} already has a balance noted on ${day}: one a day. Note another day's.`,
            { action: "show", ...namedBy(found) },
          ),
        QueryFailed: Effect.die,
      }),
    );

    // The movement line Gousset made of it (#31), among that day's lines of the account.
    const page = yield* searchLines(owner, {
      accountId: found.id,
      from: day,
      to: day,
      limit: DAY_LINES,
    }).pipe(
      Effect.catchTags({
        // The search is of one valid day; a database failure is Gousset's.
        LineSearchRefused: Effect.die,
        QueryFailed: Effect.die,
      }),
    );

    const search = `lines ${JSON.stringify({ action: "search", account: found.name, institution: found.institution ?? undefined, from: day, to: day })}`;

    return yield* writtenText(
      owner,
      found.id,
      [
        `Noted: ${named(found)} held ${amount({ minor, currency: found.currency })} at the end of ${day}.`,
        movementText(
          page.lines.find((line) => line.fromBalance),
          search,
        ),
      ].join("\n"),
    );
  });

const isLineId = Schema.is(LineId);
const decodeDay = Schema.decodeUnknownExit(Day);

/** Where a credit's handle comes from: the lines tool's search, which gives each line's. */
const SEARCH_LINES = 'lines {"action":"search"}';

const refuseToSearch = (message: string) =>
  Effect.fail(new ToolRefusal({ message, example: SEARCH_LINES }));

const LINE_UNKNOWN =
  "No line of the user's has this handle. Find the credit with the lines tool, whose search gives each line's handle (add account to keep to the benefit account), and copy it.";

/** The day a credit expires on, or null for none (`""`). */
function expiryOf(written: string, example: Encoded): Effect.Effect<string | null, ToolRefusal> {
  if (written === "") {
    return Effect.succeed(null);
  }

  const decoded = decodeDay(written);

  if (Exit.isSuccess(decoded)) {
    return Effect.succeed(decoded.value);
  }

  const issue = Cause.squash(decoded.cause);

  return Effect.fail(
    new ToolRefusal({
      message: `expires_on is a day, YYYY-MM-DD, or "" to take the expiry away: ${issue instanceof Error ? issue.message : "this is neither"}`,
      example: call(example),
    }),
  );
}

/** What a credit's expiry now is, on its account: its credits and what expires when. */
const expirySetText = (
  owner: string,
  lineId: string,
  accountId: string,
  expiresOn: string | null,
) =>
  showAccount(owner, accountId, { limit: 1 }).pipe(
    Effect.map((detail) => {
      const credit = detail.credits?.open.find((each) => each.lineId === lineId);

      const which =
        credit === undefined || credit.creditedOn === null
          ? `The credit on ${named(detail.account)}`
          : `The credit of ${credit.creditedOn} on ${named(detail.account)}, ${credit.label === null || credit.label === "" ? "(no label)" : credit.label},`;

      const now = expiresOn === null ? "now has no expiry." : `now expires on ${expiresOn}.`;

      return [`${which} ${now}`, creditsText(detail) ?? ""].join("\n\n");
    }),
    // Set a moment before: an account deleted in between, or a failure, is Gousset's.
    Effect.catchTags({
      AccountNotFound: Effect.die,
      DayRangeRefused: Effect.die,
      QueryFailed: Effect.die,
    }),
  );

const setExpiry = (owner: string, input: AccountsInput) =>
  Effect.gen(function* () {
    const { line, expires_on: written } = input;

    const needs =
      'set_expiry needs line and expires_on: the credit\'s handle, as lines search gives it, and a day, or "" to take the expiry away.';

    if (line === undefined) {
      return yield* refuseToSearch(needs);
    }

    if (!isLineId(line)) {
      return yield* refuseToSearch(LINE_UNKNOWN);
    }

    const example: Encoded = { action: "set_expiry", line, expires_on: "2027-01-31" };

    if (written === undefined) {
      return yield* refuse(needs, example);
    }

    const expiresOn = yield* expiryOf(written, example);

    const set = yield* setCreditExpiry(owner, line, expiresOn).pipe(
      Effect.catchTags({
        LineNotFound: () => refuseToSearch(LINE_UNKNOWN),
        NotACredit: () =>
          refuseToSearch(
            "This line is no credit of a benefit account: only money that came into a benefit account, a counted line above zero, expires. Find the credit with the lines tool's search.",
          ),
        ExpiryBeforeCredit: (early) =>
          refuse(
            `A credit cannot expire before the day it was credited, ${early.creditedOn}: give that day or a later one.`,
            { action: "set_expiry", line, expires_on: early.creditedOn },
          ),
        QueryFailed: Effect.die,
      }),
    );

    return yield* expirySetText(owner, set.lineId, set.accountId, set.expiresOn);
  });

/** The accounts family (docs/mcp.md, "Tools"): read, created and changed as the accounts page does. */
export const accountsTool = defineTool<
  AccountsInput,
  Encoded,
  AccountStore | LineStore | CategoryStore
>({
  name: "accounts",
  title: "Accounts",
  description: DESCRIPTION,
  // A repeated create makes a second account.
  idempotent: false,
  input: AccountsInput,
  example: { action: "create", name: "Livret A", kind: "livret_a", institution: "Riverside Bank" },
  access: {
    list: "read",
    show: "read",
    create: "write",
    edit: "write",
    close: "write",
    reopen: "write",
    note_balance: "write",
    set_expiry: "write",
  },
  run: (input, caller) => {
    switch (input.action) {
      case "list": {
        // A failure of the database is Gousset's, not the caller's: the door says so.
        return listAccounts(caller.userId).pipe(
          Effect.map(listText),
          Effect.catchTag("QueryFailed", Effect.die),
        );
      }

      case "show": {
        return show(caller.userId, input);
      }

      case "create": {
        return create(caller.userId, input);
      }

      case "edit": {
        return edit(caller.userId, input);
      }

      case "close": {
        return close(caller.userId, input);
      }

      case "reopen": {
        return reopen(caller.userId, input);
      }

      case "note_balance": {
        return note(caller.userId, input);
      }

      case "set_expiry": {
        return setExpiry(caller.userId, input);
      }
    }
  },
});
