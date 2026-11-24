import { accountNamed, listAccounts, noteBalance, searchLines, showAccount } from "@gousset/core";
import type {
  AccountCredit,
  AccountCredits,
  AccountDetail,
  AccountGroupList,
  AccountList,
  AccountStore,
  AccountSummary,
  BalanceCategory,
  LineRow,
  LineStore,
  Money,
  StatementCheck,
  StatementsUntil,
} from "@gousset/core";
import { Day } from "@gousset/core/account-values";
import type { AccountChoice, AccountGroup } from "@gousset/core/account-values";
import { minorDigits } from "@gousset/import";
import { Effect, Option, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { pathText } from "./categories";

/** The lines `show` gives when none are asked for, and the most it gives. */
const DEFAULT_LINES = 20;
const MAX_LINES = 100;

/** The credits of a benefit account `show` lists before saying how many more remain. */
const MAX_CREDITS = 30;

const AccountsInput = Schema.Struct({
  action: Schema.Literals(["list", "show", "note_balance"]).annotate({
    description:
      "list: every account by group, with totals per currency. show: one account, its lines and its check against the statement. note_balance: the balance of an account kept by its balance at the end of a day (writes).",
  }),
  name: Schema.optional(
    Schema.String.annotate({
      description: "show, note_balance: the account's name, as list writes it.",
    }),
  ),
  institution: Schema.optional(
    Schema.String.annotate({
      description:
        "show, note_balance: the account's bank or issuer, when two accounts share the name.",
    }),
  ),
  day: Schema.optional(
    Schema.String.annotate({
      description: "note_balance: the day whose end the balance is noted at, YYYY-MM-DD.",
    }),
  ),
  balance: Schema.optional(
    Schema.String.annotate({
      description:
        'note_balance: the balance at the end of day, a decimal in the account\'s currency, a minus for money owed ("80.00", "-1250.50").',
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
});

const DESCRIPTION = `The user's accounts and their balances; notes the balance of one kept by it (a write). \`list\` gives every open account by group: available (current accounts, deferred debit cards), restricted (benefit accounts: meal vouchers, gift cards), savings and investments, owed (loans), each with its balance today and how far its statements go, and each group's totals per currency (never converted); then the closed accounts, apart and out of the totals. \`show\` gives one account: its balance today, its last lines newest first with the balance after each, and the check of its balance against its latest statement balance, with the difference when they disagree. On a benefit account kept by its lines, \`show\` adds its credits: the order they are used in, what is left on each, and what expires when; on one kept by its balance, where its movements go.

Use \`list\` for "how much do I have, and where?", \`show\` for one account's latest lines, "does my balance match my bank's?" or "what expires when on my meal vouchers?". Both only read.

\`note_balance\` notes the balance at the end of \`day\` of an account kept by its balance (\`list\`: "kept by a noted balance"), \`balance\` a decimal in its currency, negative if owed. It makes that day's movement line, one expense or income in the account's category: the balance less the one before, less the account's other lines between them (transfers). Refused: an account kept by its lines, two balances a day, an unreadable day or amount.

\`show\` and \`note_balance\` name the account by \`name\`, as \`list\` writes it (any case); when two accounts share a name, add \`institution\`, the bank \`list\` writes after it. An unknown or ambiguous name is refused with the names to choose from. \`lines\` says how many of the last lines to give (1 to ${MAX_LINES}, ${DEFAULT_LINES} by default); when more remain, the result gives the exact call to read on with \`before\`.

Examples: {"action":"list"} · {"action":"show","name":"Livret A","institution":"Riverside Bank"} · {"action":"note_balance","name":"Gift card","day":"2026-10-31","balance":"80.00"}`;

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
 * The account a write names, or the refusal to give: the user's accounts to choose from, or, when
 * two share the name, `again`, the same call naming the first of them.
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

/** A decimal in major units, its sign kept; 11 digits of units at most. */
const BALANCE = /^([+-]?)(\d{1,11})(?:[.,](\d+))?$/;

/** A balance as a caller writes it, in minor units of `currency`; undefined when it is no decimal. */
function balanceMinorOf(written: string, currency: string): number | undefined {
  const match = BALANCE.exec(written.trim());
  const digits = minorDigits(currency);
  const fraction = match?.[3] ?? "";

  if (match === null || fraction.length > digits) {
    return undefined;
  }

  const magnitude = Number(`${match[2] ?? "0"}${fraction.padEnd(digits, "0")}`);

  // `0 - 0` is 0, where `-0` would be written "-0.00".
  return match[1] === "-" ? 0 - magnitude : magnitude;
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

/** `note_balance`: notes the balance, then reads the movement line Gousset made of it. */
function noteRun(input: typeof AccountsInput.Type, owner: string) {
  const { name, institution, day, balance } = input;

  if (name === undefined || day === undefined || balance === undefined) {
    return Effect.fail(
      new ToolRefusal({
        message:
          "note_balance needs the account's name, as list writes it, the day (YYYY-MM-DD) and the balance at the end of that day, a decimal in the account's currency.",
        example: call({
          action: "note_balance",
          name: name ?? "Gift card",
          institution,
          day: day ?? "2026-10-31",
          balance: balance ?? "80.00",
        }),
      }),
    );
  }

  if (Option.isNone(Schema.decodeUnknownOption(Day)(day))) {
    return Effect.fail(
      new ToolRefusal({
        message: `day is the day whose end the balance is noted at, a day of the calendar written YYYY-MM-DD: "${day.slice(0, 40)}" is none.`,
        example: call({ action: "note_balance", name, institution, day: "2026-10-31", balance }),
      }),
    );
  }

  return Effect.gen(function* () {
    const found = yield* accountToWrite(owner, name, institution, (each) =>
      call({
        action: "note_balance",
        name: each.name,
        institution: each.institution ?? undefined,
        day,
        balance,
      }),
    );

    const minor = balanceMinorOf(balance, found.currency);

    if (minor === undefined) {
      const digits = minorDigits(found.currency);
      const written = digits === 0 ? "80" : `80.${"0".repeat(digits)}`;

      return yield* new ToolRefusal({
        message: `balance is the balance at the end of the day, a decimal in ${found.currency} with at most ${digits} decimals, a minus for money owed, without currency nor thousands separator ("${written}", "-${written}"): "${balance.slice(0, 40)}" is none.`,
        example: call({ action: "note_balance", name, institution, day, balance: written }),
      });
    }

    const noted = yield* noteBalance(owner, found.id, day, minor);

    const page = yield* searchLines(owner, {
      accountId: found.id,
      from: noted.day,
      to: noted.day,
      limit: DAY_LINES,
    });

    const search = `lines ${JSON.stringify({ action: "search", account: found.name, institution: found.institution ?? undefined, from: noted.day, to: noted.day })}`;

    return [
      `Noted: ${named(found)} held ${amount({ minor: noted.minor, currency: found.currency })} at the end of ${noted.day}.`,
      movementText(
        page.lines.find((line) => line.fromBalance),
        search,
      ),
    ].join("\n");
  }).pipe(
    Effect.catchTags({
      AccountKeptByLines: () =>
        Effect.fail(
          new ToolRefusal({
            message: `"${name}" is kept by its lines: its balance is counted from them and checked against its statements, never noted. Only an account kept by its balance takes a noted balance: list says which.`,
            example: LIST,
          }),
        ),
      BalanceAlreadyNoted: (taken) =>
        Effect.fail(
          new ToolRefusal({
            message: `A balance of "${name}" is already noted for ${taken.day}: one a day. Note another day's balance, or show the account to read its movements.`,
            example: call({ action: "show", name, institution }),
          }),
        ),
      // Found by name a moment before: deleted in between, as good as unknown.
      AccountNotFound: () =>
        Effect.fail(
          new ToolRefusal({
            message: `The account "${name}" is gone. List the accounts again.`,
            example: LIST,
          }),
        ),
      // The search is of one valid day; a database failure is Gousset's.
      LineSearchRefused: Effect.die,
      QueryFailed: Effect.die,
    }),
  );
}

/** The accounts family (docs/mcp.md, "Tools"): read; a balance noted with the write scope (#31). */
export const accountsTool = defineTool<
  typeof AccountsInput.Type,
  typeof AccountsInput.Encoded,
  AccountStore | LineStore
>({
  name: "accounts",
  title: "Accounts",
  description: DESCRIPTION,
  // Noting a day's balance again is refused: one a day.
  idempotent: true,
  input: AccountsInput,
  example: { action: "show", name: "Livret A", institution: "Riverside Bank" },
  access: { list: "read", show: "read", note_balance: "write" },
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
        const { name } = input;

        if (name === undefined) {
          return Effect.fail(
            new ToolRefusal({
              message: "show needs the account's name, as list writes it.",
              example: call({ action: "show", name: "Current account" }),
            }),
          );
        }

        const linesCount = input.lines ?? DEFAULT_LINES;

        return Effect.gen(function* () {
          const found = yield* accountNamed(caller.userId, name, input.institution);

          return showText(
            yield* showAccount(caller.userId, found.id, {
              limit: linesCount,
              before: input.before,
            }),
            linesCount,
          );
        }).pipe(
          Effect.catchTags({
            AccountNameUnknown: (unknown) => {
              const [first] = unknown.accounts;

              return Effect.fail(
                new ToolRefusal({
                  message:
                    first === undefined
                      ? "The user has no account in Gousset yet: there is nothing to show."
                      : `No account of the user's is named "${unknown.name}"${input.institution === undefined ? "" : ` at "${input.institution}"`}. Their accounts: ${unknown.accounts.map(named).join(", ")}. Call show again with one of these names.`,
                  example:
                    first === undefined
                      ? call({ action: "list" })
                      : call({
                          action: "show",
                          name: first.name,
                          institution: first.institution ?? undefined,
                        }),
                }),
              );
            },
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
                  example: call({
                    action: "show",
                    name: first?.name ?? ambiguous.name,
                    institution: first?.institution ?? undefined,
                  }),
                }),
              );
            },
            // Found by name a moment before: deleted in between, as good as unknown.
            AccountNotFound: () =>
              Effect.fail(
                new ToolRefusal({
                  message: `The account "${name}" is gone. List the accounts again.`,
                  example: call({ action: "list" }),
                }),
              ),
            // The default days always make a valid range; a database failure is Gousset's.
            DayRangeRefused: Effect.die,
            QueryFailed: Effect.die,
          }),
        );
      }

      case "note_balance": {
        return noteRun(input, caller.userId);
      }
    }
  },
});
