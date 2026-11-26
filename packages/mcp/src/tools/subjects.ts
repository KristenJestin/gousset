import {
  MAX_ATTACHED,
  MAX_SUBJECTS,
  accountNamed,
  attachSubject,
  createSubject,
  editSubject,
  lineExpensesOf,
  listSubjects,
  pathOf,
  refuseProposals,
  showSubject,
  subjectMerchantsPreview,
  subjectNamed,
} from "@gousset/core";
import type {
  AccountStore,
  Expenses,
  Merchants,
  Money,
  SubjectAccountBalance,
  SubjectAttachment,
  SubjectDetail,
  SubjectExpense,
  SubjectHeadline,
  SubjectList,
  SubjectRecord,
  SubjectRefused,
  SubjectSaved,
} from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { minorDigits } from "@gousset/import";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import type { Caller } from "../tool";
import { amount, named } from "./accounts";
import { benchmarkCurrency, pathText } from "./categories";
import { merchantNamed } from "./merchants";

// The subjects family (v0.5, #37; docs/vision.md, "Subjects"): what the money is spent for, beside
// its category. Every figure, proposal and refusal is the core's (`@gousset/core`'s subjects); the
// tool names subjects, accounts and merchants by name and answers in words.

const Names = Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_ATTACHED));

const SubjectsInput = Schema.Struct({
  action: Schema.Literals(["list", "show", "create", "edit", "attach"]),
  subject: Schema.optional(
    Schema.String.annotate({
      description:
        'show, edit, attach: the subject, by its path ("House > Garden shed") or its own name, any case.',
    }),
  ),
  period: Schema.optional(
    Schema.Union([Schema.Literal("all"), Schema.Int]).annotate({
      description: 'show: a year (2026; the current one if left out), or "all" for all time.',
    }),
  ),
  name: Schema.optional(
    Schema.String.annotate({
      description: "create: its name; edit: its new name. 1 to 100 characters, no >.",
    }),
  ),
  parent: Schema.optional(
    Schema.NullOr(
      Schema.String.annotate({
        description:
          "create, edit: the subject it goes under, by path or name; null (edit) moves it to the top.",
      }),
    ),
  ),
  value: Schema.optional(
    Schema.NullOr(
      Schema.String.annotate({
        description:
          'create, edit: what it is worth, a decimal from 0 in currency ("12000", "8500.50"); null clears it.',
      }),
    ),
  ),
  currency: Schema.optional(
    Schema.String.annotate({
      description: "With value: its ISO 4217 code; the user's own currency if left out.",
    }),
  ),
  loan: Schema.optional(
    Schema.NullOr(
      Schema.String.annotate({
        description:
          "create, edit: the loan account it is bought with, as accounts lists it; null clears it.",
      }),
    ),
  ),
  starts_on: Schema.optional(
    Schema.NullOr(
      Schema.String.annotate({
        description:
          "create, edit: the first day of its dates, YYYY-MM-DD (a trip, a renovation); null clears its dates.",
      }),
    ),
  ),
  ends_on: Schema.optional(
    Schema.NullOr(
      Schema.String.annotate({
        description:
          "create, edit: its last day, YYYY-MM-DD, on or after starts_on; left out or null, it goes on.",
      }),
    ),
  ),
  accounts: Schema.optional(
    Names.annotate({
      description:
        'create, edit: the accounts linked to it, as accounts lists them ("Name (Institution)" when two share a name); edit replaces them all, [] unlinks every one.',
    }),
  ),
  merchants: Schema.optional(
    Names.annotate({
      description:
        "create, edit: its merchants, as merchants lists them: a rule each attaches it to their expenses to come; edit replaces them all.",
    }),
  ),
  attach_past: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "create, edit, with merchants: true attaches the past expenses of the merchants added too.",
    }),
  ),
  archived: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "edit: true archives it (it keeps its expenses and gets no new one), false restores it.",
    }),
  ),
  expenses: Schema.optional(
    Names.annotate({
      description: "attach: expenses, by the id show writes after expense:.",
    }),
  ),
  lines: Schema.optional(
    Names.annotate({
      description:
        "attach: lines, by the handle lines search gives: each line's expense (every share of a split line).",
    }),
  ),
  remove: Schema.optional(
    Schema.Boolean.annotate({ description: "attach: true takes them off the subject." }),
  ),
  decline: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "attach: true declines a dated subject's proposals: never proposed for it again, unless attached by hand.",
    }),
  ),
});

type SubjectsInput = typeof SubjectsInput.Type;

type Encoded = typeof SubjectsInput.Encoded;

const encodeInput = Schema.encodeSync(SubjectsInput);

const CREATE_EXAMPLE = {
  action: "create",
  name: "Van",
  merchants: ["Fuelstop"],
  attach_past: true,
} as const satisfies Encoded;

const DATED_EXAMPLE = {
  action: "create",
  name: "Alps 2026",
  starts_on: "2026-07-01",
  ends_on: "2026-07-14",
} as const satisfies Encoded;

const DESCRIPTION = `What the user's money is spent for, beside its category: subjects they make (Van, House > Garden shed, Alps 2026), nested at any depth, archived rather than deleted. An expense has zero, one or several; it counts whole in each, and once in a parent, which counts its children's expenses with its own: subjects' totals never add up. A subject may have a value (what it is worth, and the loan it is bought with) and dates (a trip, a renovation).

\`list\`: the tree, each subject by its path, with its options and its figure: this year's cost and per month, or with dates its cost in all. \`show\` one (\`subject\`) for \`period\` (a year, the current one by default, or "all"): total, month by month, by category, its accounts and loan with their balances, its value, children, latest expenses; with dates, the proposals: the expenses of its period not attached yet. A proposal is the user's to confirm: never attach one without their yes.

Use it for "what did the van cost this year?" or "what did the Alps trip cost?". For a month by subject, \`month\` \`spending\` with \`by: "subject"\`; for a subject's lines, \`lines\` \`search\` with \`subject\`; to share a line between subjects, \`lines\` \`split\` with each share's \`subjects\`.

Writes (write scope): \`create\` (\`name\`; \`parent\`, \`value\` with \`currency\`, \`loan\`, \`starts_on\`, \`ends_on\`, \`accounts\`, \`merchants\`); \`edit\` one by \`subject\`: only what it is given changes, null clears, \`accounts\` and \`merchants\` replace the whole list, \`archived\` archives or restores it. \`merchants\`: a rule "merchant is" each attaches the subject to their expenses to come; \`attach_past: true\` attaches their past ones too. \`attach\` \`expenses\` (the ids show writes) or \`lines\` (handles lines search gives) to \`subject\`; \`remove: true\` takes them off; \`decline: true\` declines proposals, remembered: never proposed for it again unless attached by hand.

Name subjects by path ("House > Garden shed") or by their own name when only one has it, merchants as \`merchants\` lists them, accounts as \`accounts\` does. Refused, saying what to do: an unknown or ambiguous name, a sibling's name or one holding ">", a subject under itself or one of its descendants, an archived parent, an expense attached to an archived subject, a value with more decimals than its currency, a loan that is no loan account, an end before the start or without one, an income (only expenses have subjects), over ${MAX_ATTACHED} expenses at once, ${MAX_SUBJECTS} subjects.

Examples: ${JSON.stringify(CREATE_EXAMPLE)} · ${JSON.stringify(DATED_EXAMPLE)} · {"action":"show","subject":"House > Garden shed","period":"all"} · {"action":"attach","subject":"Alps 2026","expenses":["<an id show gave>"]} · {"action":"edit","subject":"Garden shed","parent":null}`;

const call = (input: Encoded) => `subjects ${JSON.stringify(input)}`;

const refuse = (message: string, example: Encoded) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

const LIST_CALL = { action: "list" } as const satisfies Encoded;

/** A name as the caller gave it, cut so that one long argument never fills an error. */
const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

const quoted = (label: string) => (label === "" ? "(no label)" : `"${label}"`);

/** Sums in other currencies, never converted; nothing when there are none. */
const elsewhereText = (elsewhere: ReadonlyArray<Money>) =>
  elsewhere.length === 0
    ? ""
    : `, and ${elsewhere.map(amount).join(" + ")} in another currency, not converted`;

const datesText = (startsOn: string, endsOn: string | null) =>
  endsOn === null ? `from ${startsOn}, ongoing` : `from ${startsOn} to ${endsOn}`;

/** A subject's figure in the list: this year's and per month, or with dates in all. */
function headlineText(headline: SubjectHeadline): string {
  switch (headline.kind) {
    case "monthly": {
      const perMonth =
        headline.perMonth === null
          ? ""
          : `, ${amount(headline.perMonth)} a month over ${headline.months} month(s)`;

      return `${amount(headline.total)}${elsewhereText(headline.elsewhere)} in ${headline.year}${perMonth}`;
    }

    case "dated": {
      return `${datesText(headline.startsOn, headline.endsOn)}: ${amount(headline.total)}${elsewhereText(headline.elsewhere)} in all`;
    }
  }
}

/** Its value, loan and linked accounts, in words; its dates too unless `withDates` is false. */
function optionsOf(
  subject: Pick<SubjectRecord, "value" | "loan" | "accounts" | "startsOn" | "endsOn">,
  withDates: boolean,
): ReadonlyArray<string> {
  return [
    ...(subject.value === null ? [] : [`worth ${amount(subject.value)}`]),
    ...(subject.loan === null ? [] : [`bought with the loan ${named(subject.loan)}`]),
    ...(withDates && subject.startsOn !== null
      ? [`dates ${datesText(subject.startsOn, subject.endsOn)}`]
      : []),
    ...(subject.accounts.length === 0
      ? []
      : [`linked to ${subject.accounts.map(named).join(", ")}`]),
  ];
}

const archivedText = (archived: boolean) => (archived ? " (archived)" : "");

/** The tree, each subject by its path, its figure and its options. */
export function listText(list: SubjectList): string {
  if (list.subjects.length === 0) {
    return `The user has no subject yet. A subject is what money is spent for (a van, a house, a trip); make one with: ${call(CREATE_EXAMPLE)}`;
  }

  const [first] = list.subjects;

  const rows = list.subjects.map((subject) => {
    const options = optionsOf(subject, false);

    return `- ${pathOf(list.subjects, subject.id)}${archivedText(subject.archived)}: ${headlineText(subject.headline)}${options.length === 0 ? "" : `; ${options.join("; ")}`}`;
  });

  return [
    `${list.subjects.length} subject(s), in ${list.currency}, read on ${list.today}, each by its path, a parent before its children. A parent counts its children's expenses with its own, each once; an expense on several subjects counts whole in each, so the figures never add up.`,
    rows.join("\n"),
    `One subject's costs, month by month and by category: ${call({ action: "show", subject: first === undefined ? "Van" : pathOf(list.subjects, first.id), period: "all" })}`,
  ].join("\n\n");
}

/** An expense as show lists it, with the id attach takes. */
const expenseText = (expense: SubjectExpense) =>
  `- ${expense.happenedOn}, ${expense.merchant ?? "no merchant"}, ${quoted(expense.label)}, in ${pathText(expense.category)}: ${amount(expense.net)}; expense: ${expense.entryId}`;

const balanceText = (account: SubjectAccountBalance) =>
  `${named(account)}${account.closedOn === null ? "" : ", closed"}, balance ${amount(account.balance)}`;

function periodText(detail: SubjectDetail): string {
  return detail.period.kind === "year"
    ? `${detail.period.year} (${detail.period.from} to ${detail.period.to})`
    : `all time, to ${detail.period.to}`;
}

/** What a dated subject proposes, never attached without the user's yes; nothing without dates. */
function proposalsText(detail: SubjectDetail, path: string): ReadonlyArray<string> {
  const { proposals } = detail;

  if (proposals === null) {
    return [];
  }

  const [first] = proposals.expenses;

  if (first === undefined) {
    return ["Proposals: no expense of its period waits to be attached."];
  }

  const more =
    proposals.more === 0
      ? []
      : [`And ${proposals.more} more: attach or decline these, then show it again.`];

  return [
    [
      `Proposals: ${proposals.expenses.length + proposals.more} expense(s) of its period attached neither to it nor to a subject within it, the oldest first. They are the user's to confirm: never attach one without the user's yes.`,
      ...proposals.expenses.map(expenseText),
      ...more,
      `Once the user says yes: ${call({ action: "attach", subject: path, expenses: [first.entryId] })}; one the user says is not for it: ${call({ action: "attach", subject: path, expenses: [first.entryId], decline: true })}`,
    ].join("\n"),
  ];
}

/** A subject's page: its costs in the period, its options, its children and expenses. */
export function showText(detail: SubjectDetail, path: string): string {
  const options = [
    ...(detail.value === null ? [] : [`Value: ${amount(detail.value)}.`]),
    ...(detail.loan === null ? [] : [`Loan: ${balanceText(detail.loan)}.`]),
    ...(detail.startsOn === null ? [] : [`Dates: ${datesText(detail.startsOn, detail.endsOn)}.`]),
    ...(detail.accounts.length === 0
      ? []
      : [`Linked accounts: ${detail.accounts.map(balanceText).join("; ")}.`]),
    detail.merchants.length === 0
      ? "No merchant's rule attaches it."
      : `Its merchants, whose rule attaches it to their expenses: ${detail.merchants.map((merchant) => merchant.name).join(", ")}.`,
    ...(detail.otherRules === 0
      ? []
      : [
          `${detail.otherRules} other rule(s) attach it: rules ${JSON.stringify({ action: "list" })}.`,
        ]),
  ];

  const months =
    detail.months.length === 0
      ? []
      : [
          [
            "By month:",
            ...detail.months.map((each) => `- ${each.month}: ${amount(each.spent)}`),
          ].join("\n"),
        ];

  const categories =
    detail.categories.length === 0
      ? []
      : [
          [
            "By category, the largest first:",
            ...detail.categories.map(
              (each) => `- ${pathText(each.category)}: ${amount(each.spent)}`,
            ),
          ].join("\n"),
        ];

  const children =
    detail.children.length === 0
      ? []
      : [
          [
            "Its subjects within, each with what it cost in the period:",
            ...detail.children.map(
              (child) =>
                `- ${path} > ${child.name}${archivedText(child.archived)}: ${amount(child.total)}${elsewhereText(child.elsewhere)}`,
            ),
          ].join("\n"),
        ];

  const { latest, count } = detail.expenses;

  const expenses =
    latest.length === 0
      ? ["No expense in the period."]
      : [
          [
            `Its latest expenses, newest first (${latest.length} of ${count} in the period; day, merchant, label, category: net cost; the id attach takes):`,
            ...latest.map(expenseText),
          ].join("\n"),
        ];

  return [
    [
      `Subject: ${path}${archivedText(detail.archived)}. Period: ${periodText(detail)}, in ${detail.currency}.`,
      `Cost: ${amount(detail.total)}${elsewhereText(detail.elsewhere)}, its subjects within counted with it, each expense once.`,
      ...options,
    ].join("\n"),
    ...months,
    ...categories,
    ...children,
    ...expenses,
    ...proposalsText(detail, path),
  ].join("\n\n");
}

/** The subject named `name`, or the refusal to give; `retry` writes the call again with a path. */
function subjectOf(owner: string, name: string, retry: (path: string) => Encoded) {
  return subjectNamed(owner, name.trim()).pipe(
    Effect.catchTags({
      SubjectNameUnknown: (unknown) => {
        const [first] = unknown.close;

        return first === undefined
          ? refuse(
              `No subject of the user's is named "${clip(unknown.name)}". Name one by its path ("House > Garden shed") or its own name, as list writes it.`,
              LIST_CALL,
            )
          : refuse(
              `No subject of the user's is named "${clip(unknown.name)}". Close: ${unknown.close.join(", ")}. Call again with one of them, as it is written.`,
              retry(first),
            );
      },
      SubjectNameAmbiguous: (ambiguous) =>
        refuse(
          `Several subjects are named "${clip(ambiguous.name)}": ${ambiguous.matches.join(", ")}. Name one by its path, as written here.`,
          retry(ambiguous.matches[0] ?? ambiguous.name),
        ),
      QueryFailed: Effect.die,
    }),
  );
}

/** "Name (Institution)", as `accounts` writes an account whose name another shares. */
const WITH_INSTITUTION = /^(.+) \(([^()]+)\)$/;

/** The account a caller names, as `accounts` lists it, or the refusal to give. */
function accountOf(owner: string, written: string, field: string) {
  const text = written.trim();
  const split = WITH_INSTITUTION.exec(text);
  const accountsCall = `accounts ${JSON.stringify({ action: "list" })}`;

  return accountNamed(owner, text).pipe(
    Effect.catchTag("AccountNameUnknown", (unknown) =>
      split === null
        ? Effect.fail(unknown)
        : accountNamed(owner, split[1] ?? text, split[2] ?? undefined),
    ),
    Effect.catchTags({
      AccountNameUnknown: (unknown) =>
        Effect.fail(
          new ToolRefusal({
            message:
              unknown.accounts.length === 0
                ? `The user has no account in Gousset yet: ${field} names none.`
                : `${field}: no account of the user's is named "${clip(text)}". Their accounts: ${unknown.accounts.map(named).join(", ")}. Name one as written here.`,
            example: accountsCall,
          }),
        ),
      AccountNameAmbiguous: (ambiguous) =>
        Effect.fail(
          new ToolRefusal({
            message: `${field}: several accounts of the user's are named "${clip(ambiguous.name)}": ${ambiguous.matches.map(named).join(", ")}. Name one as written here, its institution in brackets.`,
            example: accountsCall,
          }),
        ),
    }),
  );
}

/** A decimal from 0; its minor units are the currency's. */
const DECIMAL = /^(\d{1,13})(?:[.,](\d+))?$/;

/** The value a caller writes, in minor units of `currency`, or undefined when it is none. */
function minorOf(written: string, currency: string): number | undefined {
  const match = DECIMAL.exec(written.trim());
  const digits = minorDigits(currency);
  const fraction = match?.[2] ?? "";

  return match === null || fraction.length > digits
    ? undefined
    : Number(`${match[1] ?? "0"}${fraction.padEnd(digits, "0")}`);
}

/** The value and its currency a create or an edit sets: left out, null, or in minor units. */
function valueOf(input: SubjectsInput, caller: Caller, encoded: Encoded) {
  const { value } = input;

  if (value === undefined) {
    return input.currency === undefined
      ? Effect.succeed(undefined)
      : refuse("currency goes with value: give the value too, a decimal in that currency.", {
          ...encoded,
          value: "12000",
        });
  }

  if (value === null) {
    return Effect.succeed({ valueMinor: null, valueCurrency: null });
  }

  const currency = (input.currency ?? benchmarkCurrency(caller)).trim().toUpperCase();
  const minor = minorOf(value, currency);
  const digits = minorDigits(currency);

  return minor === undefined
    ? refuse(
        `value is what the subject is worth in ${currency}: a decimal from 0 with at most ${digits} decimals, without sign nor currency ("12000"${digits > 0 ? `, "8500.${"5".padEnd(digits, "0")}"` : ""}).`,
        { ...encoded, value: "12000" },
      )
    : Effect.succeed({ valueMinor: minor, valueCurrency: currency });
}

/** The ids of what a create or an edit names: its parent, loan, accounts and merchants. */
function namesOf(owner: string, input: SubjectsInput, caller: Caller, encoded: Encoded) {
  return Effect.gen(function* () {
    const { parent, loan, accounts, merchants } = input;

    const parentId =
      parent === undefined || parent === null
        ? parent
        : (yield* subjectOf(owner, parent, (path) => ({ ...encoded, parent: path }))).id;

    const loanAccountId =
      loan === undefined || loan === null ? loan : (yield* accountOf(owner, loan, "loan")).id;

    const accountIds =
      accounts === undefined
        ? undefined
        : yield* Effect.forEach(accounts, (each) =>
            accountOf(owner, each, "accounts").pipe(Effect.map((found) => found.id)),
          );

    const merchantIds =
      merchants === undefined
        ? undefined
        : yield* Effect.forEach(merchants, (each) =>
            merchantNamed(owner, each.trim()).pipe(Effect.map((found) => found.id)),
          );

    const value = yield* valueOf(input, caller, encoded);

    return {
      parentId,
      loanAccountId,
      accountIds,
      merchantIds,
      valueMinor: value?.valueMinor,
      valueCurrency: value?.valueCurrency,
      startsOn: input.starts_on,
      endsOn: input.ends_on,
      attachPast: input.attach_past,
    };
  });
}

/** Why a change of the subjects was refused, what to do, and the call to make instead. */
function subjectRefusal(
  refused: SubjectRefused,
  input: SubjectsInput,
  encoded: Encoded,
  caller: Caller,
) {
  const subject = input.subject ?? input.name ?? "Van";

  switch (refused.reason) {
    case "name": {
      return refuse(
        'A subject\'s name is 1 to 100 characters, without ">", which only writes a path ("House > Garden shed"): name a child by its own name, with parent.',
        { action: "create", name: "Garden shed", parent: "House" },
      );
    }

    case "parent_missing": {
      return refuse(
        "The parent is none of the user's subjects any more: list them again.",
        LIST_CALL,
      );
    }

    case "parent_archived": {
      return refuse(
        `"${clip(input.parent ?? "")}" is archived: an archived subject can no longer be a parent. Restore it first, or choose another parent.`,
        { action: "edit", subject: input.parent ?? "House", archived: false },
      );
    }

    case "cycle": {
      return refuse(
        `"${clip(subject)}" cannot go under itself nor under one of its own subjects within: choose a parent outside its branch, or null for the top level.`,
        { action: "edit", subject, parent: null },
      );
    }

    case "value": {
      return refuse(
        'value is a decimal from 0 with no more decimals than its currency has, and currency an ISO 4217 code ("EUR").',
        { ...encoded, value: "12000", currency: benchmarkCurrency(caller) },
      );
    }

    case "loan": {
      return Effect.fail(
        new ToolRefusal({
          message: `"${clip(input.loan ?? "")}" is no loan account of the user's: name one of their accounts of kind loan, as accounts lists it, or null for none.`,
          example: `accounts ${JSON.stringify({ action: "list" })}`,
        }),
      );
    }

    case "account": {
      return Effect.fail(
        new ToolRefusal({
          message: "A linked account is none of the user's any more: list their accounts again.",
          example: `accounts ${JSON.stringify({ action: "list" })}`,
        }),
      );
    }

    case "dates": {
      return refuse(
        "starts_on and ends_on are days that exist, YYYY-MM-DD; the end is on or after the start, and needs one.",
        { ...encoded, starts_on: "2026-07-01", ends_on: "2026-07-14" },
      );
    }

    case "too_many": {
      return refuse(
        `The user has ${MAX_SUBJECTS} subjects, archived ones included, the most there may be: edit one of them instead.`,
        LIST_CALL,
      );
    }

    case "archived": {
      return refuse(
        `"${clip(subject)}" is archived: it gets no new expense nor merchant. An expense may still be taken off it (attach with remove: true); to attach some, restore it first.`,
        { action: "edit", subject, archived: false },
      );
    }

    case "not_an_expense": {
      return refuse(
        "Only an expense has subjects: one of them is an income (money in). Leave it out.",
        { action: "show", subject },
      );
    }

    case "entries": {
      return refuse(`At most ${MAX_ATTACHED} expenses in one call: give them in parts.`, {
        ...encoded,
        expenses: (input.expenses ?? []).slice(0, MAX_ATTACHED),
      });
    }

    case "period": {
      return refuse('period is a year from 1900 to 9999, or "all" for all time.', {
        action: "show",
        subject,
        period: "all",
      });
    }
  }
}

/** The refusals every change of a subject may meet, as the core gives them. */
function savingRefusals(input: SubjectsInput, encoded: Encoded, caller: Caller) {
  return {
    SubjectRefused: (refused: SubjectRefused) => subjectRefusal(refused, input, encoded, caller),
    SubjectNameTaken: (taken: { readonly name: string }) =>
      refuse(
        `A subject under the same parent is named "${clip(taken.name)}" already (any case): choose another name, or edit that one.`,
        LIST_CALL,
      ),
    MerchantNotFound: () =>
      Effect.fail(
        new ToolRefusal({
          message:
            "A merchant is gone: it was just merged away. Find the name it goes by now, then call again with it.",
          example: `merchants ${JSON.stringify({ action: "list" })}`,
        }),
      ),
    TooManyRules: (many: { readonly limit: number }) =>
      Effect.fail(
        new ToolRefusal({
          message: `The user has ${many.limit} rules, the most there may be, and each merchant of a subject is one: delete a rule they no longer need first.`,
          example: `rules ${JSON.stringify({ action: "list" })}`,
        }),
      ),
    QueryFailed: Effect.die,
  };
}

/** The subject's path once saved: the list reads its parents. */
function savedPath(owner: string, caller: Caller, saved: SubjectSaved) {
  return listSubjects(owner, benchmarkCurrency(caller)).pipe(
    Effect.map((list) => pathOf(list.subjects, saved.id) || saved.name),
  );
}

/** What a create or an edit did, and what its merchants' past expenses come to. */
function savedText(
  owner: string,
  caller: Caller,
  saved: SubjectSaved,
  input: SubjectsInput,
  lead: string,
) {
  return Effect.gen(function* () {
    const path = yield* savedPath(owner, caller, saved);
    const options = optionsOf(saved, true);

    const described = `${lead} the subject ${path}${archivedText(saved.archived)}${options.length === 0 ? "" : `: ${options.join("; ")}`}.`;

    const merchants = yield* Effect.forEach(input.merchants ?? [], (each) =>
      merchantNamed(owner, each.trim()),
    );

    if (merchants.length === 0) {
      return described;
    }

    const names = merchants.map((each) => each.name);
    const rules = `A rule "merchant is" for each of ${names.join(", ")} attaches it to their expenses to come.`;

    if (input.attach_past === true) {
      return `${described}\n${rules} ${saved.attached} past expense(s) of theirs attached now.`;
    }

    const preview = yield* subjectMerchantsPreview(
      owner,
      merchants.map((each) => each.id),
      benchmarkCurrency(caller),
    );

    return `${described}\n${rules} Their past expenses stay as they are: ${preview.expenses} of them, ${amount(preview.total)}${elsewhereText(preview.elsewhere)}. To attach them too: ${call({ action: "edit", subject: path, merchants: names, attach_past: true })}`;
  });
}

function create(owner: string, input: SubjectsInput, caller: Caller) {
  const name = input.name?.trim() ?? "";
  const encoded = encodeInput(input);

  if (name === "") {
    return refuse("create needs name: the subject's own name, 1 to 100 characters.", {
      ...encoded,
      name: "Van",
    });
  }

  return Effect.gen(function* () {
    const names = yield* namesOf(owner, input, caller, encoded);

    const made = yield* createSubject(owner, {
      name,
      parentId: names.parentId,
      valueMinor: names.valueMinor,
      valueCurrency: names.valueCurrency,
      loanAccountId: names.loanAccountId,
      startsOn: names.startsOn,
      endsOn: names.endsOn,
      accountIds: names.accountIds,
      merchantIds: names.merchantIds,
      attachPast: names.attachPast,
    });

    return yield* savedText(owner, caller, made, input, "Created");
  }).pipe(Effect.catchTags(savingRefusals(input, encoded, caller)));
}

function edit(owner: string, input: SubjectsInput, caller: Caller) {
  const subject = input.subject?.trim() ?? "";
  const encoded = encodeInput(input);

  if (subject === "") {
    return refuse("edit needs subject: its path or its own name, as list writes it.", LIST_CALL);
  }

  const changes = [
    input.name,
    input.parent,
    input.value,
    input.currency,
    input.loan,
    input.starts_on,
    input.ends_on,
    input.accounts,
    input.merchants,
    input.archived,
  ];

  if (changes.every((change) => change === undefined)) {
    return refuse(
      "edit needs what changes: name, parent, value, loan, starts_on, ends_on, accounts, merchants or archived.",
      { action: "edit", subject, archived: true },
    );
  }

  return Effect.gen(function* () {
    const found = yield* subjectOf(owner, subject, (path) => ({ ...encoded, subject: path }));
    const names = yield* namesOf(owner, input, caller, encoded);

    const edited = yield* editSubject(owner, found.id, {
      name: input.name,
      parentId: names.parentId,
      valueMinor: names.valueMinor,
      valueCurrency: names.valueCurrency,
      loanAccountId: names.loanAccountId,
      startsOn: names.startsOn,
      endsOn: names.endsOn,
      accountIds: names.accountIds,
      merchantIds: names.merchantIds,
      attachPast: names.attachPast,
      archived: input.archived,
    });

    return yield* savedText(owner, caller, edited, input, "Changed");
  }).pipe(
    Effect.catchTags({
      ...savingRefusals(input, encoded, caller),
      SubjectNotFound: () => refuse("The subject is gone: list the subjects again.", LIST_CALL),
    }),
  );
}

function show(owner: string, input: SubjectsInput, caller: Caller) {
  const subject = input.subject?.trim() ?? "";
  const encoded = encodeInput(input);

  if (subject === "") {
    return refuse("show needs subject: its path or its own name, as list writes it.", LIST_CALL);
  }

  return Effect.gen(function* () {
    const found = yield* subjectOf(owner, subject, (path) => ({ ...encoded, subject: path }));
    const { period } = input;

    const detail = yield* showSubject(
      owner,
      found.id,
      benchmarkCurrency(caller),
      period === undefined ? undefined : period === "all" ? "all" : { year: period },
    );

    return showText(detail, found.path);
  }).pipe(
    Effect.catchTags({
      SubjectRefused: (refused) => subjectRefusal(refused, input, encoded, caller),
      SubjectNotFound: () => refuse("The subject is gone: list the subjects again.", LIST_CALL),
      QueryFailed: Effect.die,
    }),
  );
}

/** The expenses of the lines a caller names, by their handles. */
function expensesOfLines(owner: string, handles: ReadonlyArray<string>) {
  return Effect.forEach(handles, (handle) =>
    lineExpensesOf(owner, handle.trim()).pipe(
      Effect.flatMap(({ expenses }) =>
        expenses.length === 0
          ? Effect.fail(
              new ToolRefusal({
                message: `The line "${clip(handle)}" is part of no expense (held for review, of no amount, or a side of a transfer): only an expense has subjects.`,
                example: `lines ${JSON.stringify({ action: "show", line: handle })}`,
              }),
            )
          : Effect.succeed(expenses.map((expense) => expense.id)),
      ),
      Effect.catchTags({
        LineNotFound: () =>
          Effect.fail(
            new ToolRefusal({
              message: `No line of the user's has the handle "${clip(handle)}". Handles come from lines search.`,
              example: `lines ${JSON.stringify({ action: "search", text: "fuelstop" })}`,
            }),
          ),
        QueryFailed: Effect.die,
      }),
    ),
  ).pipe(Effect.map((each) => each.flat()));
}

function attachedText(done: SubjectAttachment, path: string, input: SubjectsInput): string {
  const unchanged = done.entries - done.changed;

  if (input.decline === true) {
    return `Declined ${done.changed} proposal(s) for ${path}${unchanged === 0 ? "" : ` (${unchanged} already were)`}: never proposed for it again, unless the user attaches one by hand.`;
  }

  if (input.remove === true) {
    return `Took ${done.changed} expense(s) off ${path}${unchanged === 0 ? "" : `; ${unchanged} were not on it`}. They no longer count in its cost.`;
  }

  return `Attached ${done.changed} expense(s) to ${path}${unchanged === 0 ? "" : `; ${unchanged} already were`}. Each counts whole in its cost, and once in each subject above it.`;
}

function attach(owner: string, input: SubjectsInput, caller: Caller) {
  const subject = input.subject?.trim() ?? "";
  const encoded = encodeInput(input);
  const expenses = input.expenses ?? [];
  const lines = input.lines ?? [];

  if (subject === "" || expenses.length + lines.length === 0) {
    return refuse(
      "attach needs subject, by path or name, and expenses (the ids show writes after expense:) or lines (handles lines search gives).",
      { action: "attach", subject: subject || "Van", expenses: ["<an id show gave>"] },
    );
  }

  if (input.remove === true && input.decline === true) {
    return refuse(
      "remove takes expenses off a subject; decline turns down its proposals: give one of them.",
      { ...encoded, remove: undefined },
    );
  }

  return Effect.gen(function* () {
    const found = yield* subjectOf(owner, subject, (path) => ({ ...encoded, subject: path }));
    const ofLines = yield* expensesOfLines(owner, lines);
    const ids = [...expenses.map((each) => each.trim()), ...ofLines];

    const done =
      input.decline === true
        ? yield* refuseProposals(owner, found.id, ids)
        : yield* attachSubject(owner, found.id, ids, { remove: input.remove === true });

    return attachedText(done, found.path, input);
  }).pipe(
    Effect.catchTags({
      SubjectRefused: (refused) => subjectRefusal(refused, input, encoded, caller),
      SubjectNotFound: () => refuse("The subject is gone: list the subjects again.", LIST_CALL),
      EntryNotFound: (missing) =>
        refuse(
          `No expense of the user's has the id "${clip(missing.entryId)}". Ids come from show, after expense:; a line's expense is named by its handle, with lines.`,
          { action: "show", subject },
        ),
      QueryFailed: Effect.die,
    }),
  );
}

/**
 * The subjects family (docs/mcp.md, "Tools"; #37): read, made, changed and archived, and expenses
 * attached, taken off or declined, with the write scope.
 */
export const subjectsTool = defineTool<
  SubjectsInput,
  Encoded,
  UserData | AccountStore | Merchants | Expenses
>({
  name: "subjects",
  title: "Subjects",
  description: DESCRIPTION,
  // A repeated create is refused (a sibling has the name); a repeated attach changes nothing.
  idempotent: true,
  input: SubjectsInput,
  example: { action: "show", subject: "House > Garden shed", period: "all" },
  access: {
    list: "read",
    show: "read",
    create: "write",
    edit: "write",
    attach: "write",
  },
  run: (input, caller) => {
    const owner = caller.userId;

    switch (input.action) {
      case "list": {
        return listSubjects(owner, benchmarkCurrency(caller)).pipe(
          Effect.map(listText),
          Effect.catchTags({ QueryFailed: Effect.die }),
        );
      }

      case "show": {
        return show(owner, input, caller);
      }

      case "create": {
        return create(owner, input, caller);
      }

      case "edit": {
        return edit(owner, input, caller);
      }

      case "attach": {
        return attach(owner, input, caller);
      }
    }
  },
});
