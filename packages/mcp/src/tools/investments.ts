import {
  accountNamed,
  correctInvestmentOperation,
  deleteInvestmentOperation,
  enterInvestmentOperation,
  investmentAccounts,
  investmentOperationOn,
  investmentOperations,
  investmentPosition,
  investmentPositionByIsin,
  parseIsin,
} from "@gousset/core";
import type {
  AccountRecord,
  AccountStore,
  InvalidIsin,
  InvalidQuantity,
  InvestmentAccount,
  Investments,
  NotAnInvestmentAccount,
  OperationInput,
  OperationPage,
  OperationRead,
  OperationRefused,
  PositionDetail,
  PositionRead,
  SecurityRead,
} from "@gousset/core";
import { Day, choiceOf } from "@gousset/core/account-values";
import { readAmount } from "@gousset/import";
import { Effect, Result, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { CHOICE_NAMES, amount, named } from "./accounts";

// The investments family (#250; docs/mcp.md, "Tools"): an investment account's positions and
// operations, read and written through `@gousset/core` as the investments page does.

/** The operations `show` gives a page when none are asked for, and the most it gives. */
const DEFAULT_OPERATIONS = 20;
const MAX_OPERATIONS = 100;

const KINDS = ["deposit", "withdrawal", "purchase", "sale", "dividend", "fee"] as const;

const InvestmentsInput = Schema.Struct({
  action: Schema.Literals([
    "list",
    "show",
    "add_operation",
    "edit_operation",
    "delete_operation",
  ]).annotate({
    description:
      "list: the investment accounts and their open positions. show: an account's operations, or one position. The others write.",
  }),
  account: Schema.optional(
    Schema.String.annotate({
      description: "An investment account's name, as list writes it (any case).",
    }),
  ),
  institution: Schema.optional(
    Schema.String.annotate({ description: "Its bank, when two accounts share the name." }),
  ),
  isin: Schema.optional(
    Schema.String.annotate({
      description:
        "show: one position. add_operation, edit_operation: the security of a purchase, a sale, a dividend (a fee may name one).",
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_OPERATIONS })).annotate({
      description: `show: operations a page, 1 to ${MAX_OPERATIONS}; ${DEFAULT_OPERATIONS} by default.`,
    }),
  ),
  after: Schema.optional(
    Schema.String.annotate({ description: "show: only as the result's next call gives it." }),
  ),
  operation: Schema.optional(
    Schema.String.annotate({
      description: "edit_operation, delete_operation: its handle, as show gives it.",
    }),
  ),
  kind: Schema.optional(Schema.Literals(KINDS)),
  day: Schema.optional(Day.annotate({ description: "The trade's day, YYYY-MM-DD." })),
  amount: Schema.optional(
    Schema.String.annotate({
      description: "The cash moved, signed, fees included, a decimal in the account's currency.",
    }),
  ),
  fees: Schema.optional(
    Schema.String.annotate({ description: 'Fees, or a dividend\'s tax withheld; "0" by default.' }),
  ),
  quantity: Schema.optional(
    Schema.String.annotate({ description: 'purchase, sale: units, a decimal ("2.9791").' }),
  ),
  unit_price: Schema.optional(
    Schema.String.annotate({ description: "purchase, sale: one unit's price, a decimal." }),
  ),
  security_name: Schema.optional(
    Schema.String.annotate({ description: "A security not known yet: its name." }),
  ),
});

type InvestmentsInput = typeof InvestmentsInput.Type;

type Encoded = typeof InvestmentsInput.Encoded;

/** A valid purchase: 2.9791 units at 112.4519 EUR are 335.00 EUR, and 0.99 EUR of fees. */
const PURCHASE_EXAMPLE: Encoded = {
  action: "add_operation",
  account: "Northbank PEA",
  kind: "purchase",
  day: "2026-10-14",
  isin: "XX0000000002",
  quantity: "2.9791",
  unit_price: "112.4519",
  fees: "0.99",
  amount: "-335.99",
};

const DESCRIPTION = `The user's investments, at cost: each investment account (PEA, life insurance, securities account), its positions by ISIN and their operations. At cost is what was paid, fees included: Gousset has no prices yet, so no value, gain or return. \`list\`: every investment account with its envelope and cash, and its open positions (security, ISIN, units, average cost, cost; incomplete when more was sold than held). \`show\` with \`account\`: its operations, newest first, ${DEFAULT_OPERATIONS} a page (\`limit\`; the result writes the next call); with \`isin\`, alone or with \`account\`, one position and its operations.

Use it for "what do I hold, and what did it cost?"; \`accounts\` for every account's balance, \`lines\` for other accounts' lines, \`imports\` to bring in a broker's operations file.

Writes need a connection allowed to write. \`add_operation\` enters one by hand on an investment account kept by its lines; not idempotent: a repeat adds a second. \`edit_operation\` corrects one, by its \`operation\` handle from \`show\` and its \`account\`, given whole as for add. \`delete_operation\` deletes one and its cash line. A deposit or a withdrawal is paired at once with its only transfer candidate.

\`amount\` is the cash the operation moved, signed, fees included: negative for a purchase, a fee or a withdrawal, positive for a sale, a dividend or a deposit. A purchase and a sale need \`isin\`, \`quantity\` and \`unit_price\` (decimal strings, a point for decimals), a dividend \`isin\`; a dividend's \`fees\` is its tax withheld. Refused, saying what to do: a wrong sign, an ISIN whose check digit fails, a quantity of zero, an account that is no investment or is kept by a noted balance.

Example, a purchase of 2.9791 units at 112.4519 with 0.99 of fees: ${JSON.stringify(PURCHASE_EXAMPLE)}`;

const call = (input: Encoded) => `investments ${JSON.stringify(input)}`;

const LIST: Encoded = { action: "list" };

const refuse = (message: string, example: Encoded) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

type Named = { readonly name: string; readonly institution: string | null };

/** The name and institution a call names an account by. */
const namedBy = (account: Named) => ({
  account: account.name,
  institution: account.institution ?? undefined,
});

/** A security as results name it: `World Index ETF (XX0000000002)`. */
const securityText = (security: SecurityRead) =>
  security.isin === null ? security.name : `${security.name} (${security.isin})`;

/** `3.9791 units, average cost 112.0857 EUR, cost 445.99 EUR`, and why it may be incomplete. */
function costText(position: PositionRead): string {
  const average =
    position.averageCost === null
      ? ""
      : `, average cost ${position.averageCost.value} ${position.averageCost.currency}`;

  const incomplete = position.incomplete
    ? "; incomplete: more was sold than held, earlier operations are missing"
    : "";

  return `${position.quantity} units${average}, cost ${amount(position.cost)}${incomplete}`;
}

/** What an operation was, in Gousset's words. */
function whatText(operation: OperationRead): string {
  const security = operation.security === null ? null : securityText(operation.security);

  switch (operation.kind) {
    case "purchase":
    case "sale": {
      const price =
        operation.unitPrice === null
          ? ""
          : ` at ${operation.unitPrice.value} ${operation.unitPrice.currency}`;

      return `${operation.kind} of ${operation.quantity ?? ""} ${security ?? ""}${price}`;
    }

    case "dividend":
    case "fee": {
      return security === null ? operation.kind : `${operation.kind} of ${security}`;
    }

    case "deposit":
    case "withdrawal": {
      return operation.kind;
    }
  }
}

/** One operation's row, with its handle. */
function operationLine(operation: OperationRead): string {
  const fees =
    operation.fees.minor === 0
      ? ""
      : `, ${operation.kind === "dividend" ? "tax withheld" : "fees"} ${amount(operation.fees)}`;

  const label =
    operation.label === "" || operation.label === operation.security?.name
      ? ""
      : `, ${JSON.stringify(operation.label)}`;

  const notes = [
    operation.source === "manual" ? ", entered by hand" : "",
    operation.paired ? ", paired as a transfer" : "",
    operation.state === "held" ? ", held as a near duplicate, not counted" : "",
  ].join("");

  return `- ${operation.bookedOn}, ${whatText(operation)}${fees}: ${amount(operation.amount)}${label}${notes}; operation: ${operation.id}`;
}

/** The way back to an account's operations. */
const showCall = (account: Named) => call({ action: "show", ...namedBy(account) });

function accountText(account: InvestmentAccount): string {
  const kept = account.mode === "balance" ? ", kept by a noted balance" : "";
  const closed = account.closedOn === null ? "" : `, closed on ${account.closedOn}`;

  const positions =
    account.positions.length === 0
      ? ["No open position."]
      : account.positions.map(
          (position) => `- ${securityText(position.security)}: ${costText(position)}.`,
        );

  return [
    `${named(account)}, ${CHOICE_NAMES[account.choice]} in ${account.currency}${kept}${closed}: cash ${amount(account.cash)}.`,
    ...positions,
    `Its operations: ${showCall(account)}`,
  ].join("\n");
}

function listText(accounts: ReadonlyArray<InvestmentAccount>): string {
  if (accounts.length === 0) {
    return 'The user has no investment account in Gousset yet: create one with accounts {"action":"create","name":"…","kind":"pea"} (or life_insurance, securities).';
  }

  return [
    "The user's investment accounts and their open positions, at cost: what was paid, fees included. Gousset has no prices yet, so no value, gain or return.",
    ...accounts.map(accountText),
  ].join("\n\n");
}

function pageText(
  account: AccountRecord,
  page: OperationPage,
  input: InvestmentsInput,
  limit: number,
): string {
  if (page.total === 0) {
    return `${named(account)} has no operation yet. Enter one with add_operation, or import the broker's file with imports.`;
  }

  const after = input.after === undefined ? "" : ", after the page before";

  const more =
    page.next === null
      ? []
      : [
          `More operations remain. Read them with: ${call({ action: "show", ...namedBy(account), limit, after: page.next })}`,
        ];

  return [
    `Operations of ${named(account)}, newest first${after}: ${page.operations.length} of ${page.total}.`,
    ...page.operations.map(operationLine),
    ...more,
  ].join("\n");
}

function positionText(detail: PositionDetail): string {
  const held =
    detail.position === null || !detail.position.open
      ? "Nothing held now: its position is closed, or none of its operations is booked yet."
      : `At cost: ${costText(detail.position)}.`;

  return [
    `${securityText(detail.security)} on ${named(detail.account)}, quoted in ${detail.security.currency}.`,
    held,
    "Its operations there, newest first:",
    ...detail.operations.map(operationLine),
  ].join("\n");
}

/**
 * The investment account a call names, by name and institution; a name that names none or several,
 * or an account that is no investment, is refused with what to do.
 */
const investmentAccountOf = (
  owner: string,
  name: string,
  institution: string | undefined,
  retry: (account: Named) => Encoded,
) =>
  accountNamed(owner, name, institution).pipe(
    Effect.catchTags({
      AccountNameUnknown: (unknown) =>
        refuse(
          `No account of the user's is named "${unknown.name}"${institution === undefined ? "" : ` at "${institution}"`}. Name one of the investment accounts list gives.`,
          LIST,
        ),
      AccountNameAmbiguous: (ambiguous) => {
        const [first] = ambiguous.matches;

        return refuse(
          `Several accounts of the user's are named "${ambiguous.name}": ${ambiguous.matches.map(named).join(", ")}. Add institution to tell them apart.`,
          retry(first ?? { name: ambiguous.name, institution: null }),
        );
      },
      // A failure of the database is Gousset's, not the caller's: the door says so.
      QueryFailed: Effect.die,
    }),
    Effect.flatMap((found) =>
      found.kind === "investment"
        ? Effect.succeed(found)
        : refuse(
            `${named(found)} is not an investment account but a ${CHOICE_NAMES[choiceOf(found.kind, found.envelope)]}: positions and operations are on a PEA, a life insurance or a securities account.`,
            LIST,
          ),
    ),
  );

/** An ISIN as the core writes it, or the refusal of one whose check digit fails. */
function isinOf(given: string, retry: Encoded): Effect.Effect<string, ToolRefusal> {
  const parsed = parseIsin(given);

  return Result.isSuccess(parsed)
    ? Effect.succeed(parsed.success)
    : Effect.fail(invalidIsin(parsed.failure, retry));
}

const invalidIsin = (invalid: InvalidIsin, retry: Encoded) =>
  new ToolRefusal({
    message: `"${invalid.isin}" is not an ISIN: two letters, nine letters or digits, and a check digit (ISO 6166) that holds. Copy it again from the broker's statement; a typo makes the check digit fail.`,
    example: call({ ...retry, isin: "XX0000000002" }),
  });

/** Read a moment before: an account or a security gone in between, or a failure, is Gousset's. */
const positionOf = (owner: string, accountId: string, securityId: string) =>
  investmentPosition(owner, accountId, securityId).pipe(
    Effect.catchTags({
      AccountNotFound: Effect.die,
      SecurityNotFound: Effect.die,
      QueryFailed: Effect.die,
    }),
  );

const gone = (name: string) =>
  refuse(`The account "${name}" is gone. List the investment accounts again.`, LIST);

/** One position named by ISIN on the account the call names. */
const positionOnAccount = (owner: string, input: InvestmentsInput, name: string, isin: string) =>
  Effect.gen(function* () {
    const found = yield* investmentAccountOf(owner, name, input.institution, (account) => ({
      action: "show",
      ...namedBy(account),
      isin,
    }));

    const detail = yield* investmentPositionByIsin(owner, found.id, isin).pipe(
      Effect.catchTags({
        AccountNotFound: () => gone(name),
        SecurityNotOnAccount: () =>
          refuse(
            `${named(found)} has no operation of ${isin}. Read its operations, or the positions of every account with list.`,
            { action: "show", ...namedBy(found) },
          ),
        QueryFailed: Effect.die,
      }),
    );

    return positionText(detail);
  });

/** One open position named by ISIN alone: the account that holds it. */
const positionByIsin = (owner: string, isin: string) =>
  Effect.gen(function* () {
    const accounts = yield* investmentAccounts(owner).pipe(
      Effect.catchTag("QueryFailed", Effect.die),
    );

    const holding = accounts.flatMap((account) =>
      account.positions.flatMap((position) =>
        position.security.isin === isin ? [{ account, position }] : [],
      ),
    );

    const [only, ...others] = holding;

    if (only === undefined) {
      const [first] = accounts;

      return yield* refuse(
        `No open position of the user's has the ISIN ${isin}. list gives the open ones; for a sold-out one, name its account too.`,
        first === undefined ? LIST : { action: "show", ...namedBy(first), isin },
      );
    }

    if (others.length > 0) {
      return yield* refuse(
        `Several accounts hold ${isin}: ${holding.map((each) => named(each.account)).join(", ")}. Name the account too.`,
        { action: "show", ...namedBy(only.account), isin },
      );
    }

    return positionText(yield* positionOf(owner, only.account.id, only.position.security.id));
  });

const show = (owner: string, input: InvestmentsInput) =>
  Effect.gen(function* () {
    const { account: name } = input;
    const retry: Encoded = { action: "show", account: name ?? "Northbank PEA" };

    if (input.isin !== undefined) {
      const isin = yield* isinOf(input.isin, retry);

      return name === undefined
        ? yield* positionByIsin(owner, isin)
        : yield* positionOnAccount(owner, input, name, isin);
    }

    if (name === undefined) {
      return yield* refuse(
        "show needs account, isin or both: an account's operations, or one position.",
        retry,
      );
    }

    const found = yield* investmentAccountOf(owner, name, input.institution, (account) => ({
      ...input,
      ...namedBy(account),
    }));

    const limit = input.limit ?? DEFAULT_OPERATIONS;

    const page = yield* investmentOperations(owner, found.id, {
      after: input.after ?? null,
      limit,
    }).pipe(Effect.catchTags({ AccountNotFound: () => gone(name), QueryFailed: Effect.die }));

    return pageText(found, page, input, limit);
  });

/** The kinds that take money out of the account; the others bring it in. */
const OUT: ReadonlySet<string> = new Set(["purchase", "fee", "withdrawal"]);

/** The same amount the other way, for the call that fixes a wrong sign. */
const flipped = (written: string) =>
  written.trim().startsWith("-") ? written.trim().slice(1) : `-${written.trim()}`;

/** What each reason an operation is refused for tells the caller, and the call that fixes it. */
type Refusal = (retry: Encoded) => { readonly message: string; readonly example: Encoded };

const REFUSED = {
  sign: (retry) => ({
    message: `A ${retry.kind ?? "purchase"} ${OUT.has(retry.kind ?? "") ? "takes money out of the account: its amount is negative" : "brings money into the account: its amount is positive"}. A purchase, a fee and a withdrawal are negative, a sale, a dividend and a deposit positive.`,
    example: { ...retry, amount: flipped(retry.amount ?? "") },
  }),
  amount: (retry) => ({
    message: "amount is the cash the operation moved: never zero.",
    example: { ...retry, amount: OUT.has(retry.kind ?? "") ? "-100.00" : "100.00" },
  }),
  fees: (retry) => ({
    message: "fees are an amount from 0, in the account's currency.",
    example: { ...retry, fees: "0.99" },
  }),
  day: (retry) => ({
    message: "day is the trade's day, YYYY-MM-DD.",
    example: { ...retry, day: "2026-10-14" },
  }),
  quantity_required: (retry) => ({
    message:
      "A purchase or a sale needs quantity and unit_price, decimal strings with a point for decimals.",
    example: { ...retry, quantity: "2.9791", unit_price: "112.4519" },
  }),
  quantity_not_allowed: (retry) => ({
    message: `Only a purchase and a sale have a quantity and a unit price: leave them out for a ${retry.kind ?? "deposit"}.`,
    example: { ...retry, quantity: undefined, unit_price: undefined },
  }),
  security_required: (retry) => ({
    message: "A purchase, a sale and a dividend name their security by isin.",
    example: { ...retry, isin: "XX0000000002" },
  }),
  security_not_allowed: (retry) => ({
    message: "A deposit or a withdrawal names no security: leave isin out.",
    example: { ...retry, isin: undefined, security_name: undefined },
  }),
  currency: (retry) => ({
    message: "The security's currency is no ISO 4217 code.",
    example: retry,
  }),
} satisfies { readonly [Reason in OperationRefused["reason"]]: Refusal };

/** What a write is refused for, from the errors of `@gousset/core`. */
const writeRefusals = (found: AccountRecord, retry: Encoded) => ({
  OperationRefused: (refused: OperationRefused) => {
    const { message, example } = REFUSED[refused.reason](retry);

    return refuse(message, example);
  },
  InvalidQuantity: (invalid: InvalidQuantity) =>
    refuse(
      `"${invalid.text}" is no quantity or unit price Gousset keeps: a decimal above zero, with at most 10 decimals and no sign.`,
      { ...retry, quantity: "2.9791", unit_price: retry.unit_price ?? "112.4519" },
    ),
  InvalidIsin: (invalid: InvalidIsin) => Effect.fail(invalidIsin(invalid, retry)),
  NotAnInvestmentAccount: (refused: NotAnInvestmentAccount) =>
    refused.reason === "balance"
      ? Effect.fail(
          new ToolRefusal({
            message: `${named(found)} is kept by a noted balance: its noted balances make its movements, so it takes no operation. To follow its operations, edit it to mode lines first.`,
            example: `accounts ${JSON.stringify({ action: "edit", name: found.name, institution: found.institution ?? undefined, mode: "lines" })}`,
          }),
        )
      : refuse(`${named(found)} is not an investment account.`, LIST),
  QueryFailed: Effect.die,
});

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

/** The operation a write gives, whole, its amounts in minor units of the account's currency. */
const operationInputOf = (input: InvestmentsInput, found: AccountRecord, retry: Encoded) =>
  Effect.gen(function* () {
    const { kind, day, amount: written } = input;

    if (kind === undefined || day === undefined || written === undefined) {
      return yield* refuse(
        `${input.action} needs kind, day and amount, and for a purchase or a sale isin, quantity and unit_price.`,
        { ...PURCHASE_EXAMPLE, ...retry },
      );
    }

    const operation: OperationInput = {
      kind,
      bookedOn: day,
      valueOn: null,
      amountMinor: yield* minorOf("amount", written, found.currency, {
        ...retry,
        amount: "-335.99",
      }),
      isin: input.isin ?? null,
      securityName: input.security_name ?? null,
      securityCurrency: null,
      quantity: input.quantity ?? null,
      unitPrice: input.unit_price ?? null,
      feesMinor:
        input.fees === undefined
          ? 0
          : yield* minorOf("fees", input.fees, found.currency, { ...retry, fees: "0.99" }),
      label: null,
    };

    return operation;
  });

/** A security's position on an account after a write; null for none held. */
const heldAfter = (owner: string, accountId: string, securityId: string) =>
  investmentPosition(owner, accountId, securityId).pipe(
    Effect.map((detail) => (detail.position?.open === true ? detail.position : null)),
    Effect.catchTags({
      // No operation of the security is left on the account: nothing held.
      SecurityNotFound: () => Effect.succeed(null),
      AccountNotFound: Effect.die,
      QueryFailed: Effect.die,
    }),
  );

/** What a write answers: what it did, the operation, its position now, and how to read on. */
const writtenText = (owner: string, done: string, operation: OperationRead, account: Named) =>
  Effect.gen(function* () {
    const { security } = operation;

    const held =
      security === null ? null : yield* heldAfter(owner, operation.accountId, security.id);

    const position =
      security === null
        ? []
        : [
            held === null
              ? `${security.name}: nothing held now.`
              : `${security.name} now, at cost: ${costText(held)}.`,
          ];

    return [
      `${done} ${named(account)}:`,
      operationLine(operation),
      ...position,
      `Its operations: ${showCall(account)}`,
    ].join("\n");
  });

/** The fields a write passes on, for the call a refusal gives back. */
const retryOf = (input: InvestmentsInput, account: Named): Encoded => ({
  ...input,
  ...namedBy(account),
});

const add = (owner: string, input: InvestmentsInput) =>
  Effect.gen(function* () {
    const { account: name } = input;

    if (name === undefined) {
      return yield* refuse(
        "add_operation needs account, kind, day and amount, and for a purchase or a sale isin, quantity and unit_price.",
        PURCHASE_EXAMPLE,
      );
    }

    const found = yield* investmentAccountOf(owner, name, input.institution, (account) =>
      retryOf(input, account),
    );

    const retry = retryOf(input, found);
    const written = yield* operationInputOf(input, found, retry);

    const entered = yield* enterInvestmentOperation(owner, found.id, written).pipe(
      Effect.catchTags({ ...writeRefusals(found, retry), AccountNotFound: () => gone(name) }),
    );

    return yield* writtenText(owner, "Added to", entered, found);
  });

const NO_OPERATION =
  "No operation of the user's has this handle. Read the handles with show, which gives each operation's.";

const edit = (owner: string, input: InvestmentsInput) =>
  Effect.gen(function* () {
    const { account: name, operation: handle } = input;

    if (name === undefined || handle === undefined) {
      return yield* refuse(
        "edit_operation needs operation, its handle as show gives it, and account, the account it is on; then the operation whole, as add_operation takes it.",
        { action: "show", account: name ?? "Northbank PEA" },
      );
    }

    const found = yield* investmentAccountOf(owner, name, input.institution, (account) =>
      retryOf(input, account),
    );

    const retry = retryOf(input, found);

    yield* investmentOperationOn(owner, found.id, handle).pipe(
      Effect.catchTags({
        AccountNotFound: () => gone(name),
        OperationNotFound: () =>
          refuse(
            `${named(found)} has no operation with this handle. Read its operations, which give each one's handle.`,
            { action: "show", ...namedBy(found) },
          ),
        QueryFailed: Effect.die,
      }),
    );

    const written = yield* operationInputOf(input, found, retry);

    const corrected = yield* correctInvestmentOperation(owner, handle, written).pipe(
      Effect.catchTags({
        ...writeRefusals(found, retry),
        OperationNotFound: () => refuse(NO_OPERATION, { action: "show", ...namedBy(found) }),
      }),
    );

    return yield* writtenText(owner, "Corrected on", corrected, found);
  });

const remove = (owner: string, input: InvestmentsInput) =>
  Effect.gen(function* () {
    const { operation: handle } = input;

    if (handle === undefined) {
      return yield* refuse("delete_operation needs operation, its handle as show gives it.", {
        action: "show",
        account: "Northbank PEA",
      });
    }

    const deleted = yield* deleteInvestmentOperation(owner, handle).pipe(
      Effect.catchTags({
        OperationNotFound: () => refuse(NO_OPERATION, LIST),
        QueryFailed: Effect.die,
      }),
    );

    const accounts = yield* investmentAccounts(owner).pipe(
      Effect.catchTag("QueryFailed", Effect.die),
    );

    const account: Named = accounts.find((each) => each.id === deleted.accountId) ?? {
      name: "its account",
      institution: null,
    };

    return yield* writtenText(owner, "Deleted, with its cash line, from", deleted, account);
  });

/** The investments family (docs/mcp.md, "Tools"): positions at cost and their operations. */
export const investmentsTool = defineTool<InvestmentsInput, Encoded, AccountStore | Investments>({
  name: "investments",
  title: "Investments",
  description: DESCRIPTION,
  // A repeated add_operation enters a second operation.
  idempotent: false,
  input: InvestmentsInput,
  example: PURCHASE_EXAMPLE,
  access: {
    list: "read",
    show: "read",
    add_operation: "write",
    edit_operation: "write",
    delete_operation: "write",
  },
  run: (input, caller) => {
    switch (input.action) {
      case "list": {
        return investmentAccounts(caller.userId).pipe(
          Effect.map(listText),
          Effect.catchTag("QueryFailed", Effect.die),
        );
      }

      case "show": {
        return show(caller.userId, input);
      }

      case "add_operation": {
        return add(caller.userId, input);
      }

      case "edit_operation": {
        return edit(caller.userId, input);
      }

      case "delete_operation": {
        return remove(caller.userId, input);
      }
    }
  },
});
