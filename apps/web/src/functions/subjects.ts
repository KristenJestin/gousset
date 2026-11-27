import {
  MAX_ATTACHED,
  MAX_SUBJECT_NAME,
  attachSubject,
  createSubject as createCoreSubject,
  editSubject as editCoreSubject,
  listSubjects,
  refuseProposals,
  showSubject,
  subjectMerchantsPreview,
} from "@gousset/core";
import type { SubjectRefused } from "@gousset/core";
import { AccountId, Day } from "@gousset/core/account-values";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

// The subjects' calls (#37), on `@gousset/core`'s subjects, as the MCP door's `subjects` tool will
// read and change them. A refusal comes back as a code the page translates, said under the field it
// is about; a failure of the server itself is thrown.

/** Why a read or a change of the subjects was refused, as a code for the interface to translate. */
export type SubjectRefusalCode =
  | "SUBJECT_NOT_FOUND"
  | "SUBJECT_NAME"
  | "SUBJECT_NAME_TAKEN"
  | "SUBJECT_PARENT_MISSING"
  | "SUBJECT_PARENT_ARCHIVED"
  | "SUBJECT_CYCLE"
  | "SUBJECT_VALUE"
  | "SUBJECT_LOAN"
  | "SUBJECT_ACCOUNT"
  | "SUBJECT_DATES"
  | "SUBJECT_TOO_MANY"
  | "SUBJECT_ARCHIVED"
  | "SUBJECT_NOT_AN_EXPENSE"
  | "SUBJECT_ENTRIES"
  | "SUBJECT_PERIOD"
  | "SUBJECT_PAYBACK"
  | "SUBJECT_PAYBACK_LINES"
  | "ENTRY_NOT_FOUND"
  | "MERCHANT_NOT_FOUND"
  | "TOO_MANY_RULES";

/** A refusal's code, and the limit it names when it is one (the most rules). */
const refused = (code: SubjectRefusalCode, limit: number | null = null) =>
  Effect.succeed({ ok: false as const, code, limit });

const REASON_CODES = {
  name: "SUBJECT_NAME",
  parent_missing: "SUBJECT_PARENT_MISSING",
  parent_archived: "SUBJECT_PARENT_ARCHIVED",
  cycle: "SUBJECT_CYCLE",
  value: "SUBJECT_VALUE",
  loan: "SUBJECT_LOAN",
  account: "SUBJECT_ACCOUNT",
  dates: "SUBJECT_DATES",
  too_many: "SUBJECT_TOO_MANY",
  archived: "SUBJECT_ARCHIVED",
  not_an_expense: "SUBJECT_NOT_AN_EXPENSE",
  entries: "SUBJECT_ENTRIES",
  period: "SUBJECT_PERIOD",
  payback: "SUBJECT_PAYBACK",
  payback_lines: "SUBJECT_PAYBACK_LINES",
} as const satisfies { [Reason in SubjectRefused["reason"]]: SubjectRefusalCode };

/** The refusals every read and change of a subject may meet, as their codes. */
const REFUSALS = {
  SubjectNotFound: () => refused("SUBJECT_NOT_FOUND"),
  SubjectRefused: (refusal: SubjectRefused) => refused(REASON_CODES[refusal.reason]),
};

/** Those of an attachment or a refusal of expenses: an expense gone too. */
const EXPENSE_REFUSALS = { ...REFUSALS, EntryNotFound: () => refused("ENTRY_NOT_FOUND") };

/** A subject's id as the page gives it; one the user does not have is refused with a code. */
export const SubjectId = Schema.String.check(Schema.isMaxLength(100));

/** An id the page gives (an expense's, a merchant's); one the user does not have: a code. */
const Id = Schema.String.check(Schema.isMaxLength(100));

/** What a subject's page reads: a year, or all time. */
export const SubjectPeriod = Schema.Union([
  Schema.Literal("all"),
  Schema.Int.check(Schema.isBetween({ minimum: 1900, maximum: 9999 })),
]);

/** A subject's options, as its sheet sends them; the core checks each. */
const SubjectFields = {
  name: Schema.String.check(Schema.isMaxLength(MAX_SUBJECT_NAME * 2)),
  parentId: Schema.NullOr(SubjectId),
  valueMinor: Schema.NullOr(Schema.Finite),
  // A code that is none is the core's to refuse, under the value.
  valueCurrency: Schema.NullOr(Schema.String.check(Schema.isMaxLength(3))),
  loanAccountId: Schema.NullOr(AccountId),
  startsOn: Schema.NullOr(Day),
  endsOn: Schema.NullOr(Day),
  accountIds: Schema.Array(AccountId).check(Schema.isMaxLength(MAX_ATTACHED)),
  merchantIds: Schema.Array(Id).check(Schema.isMaxLength(MAX_ATTACHED)),
  attachPast: Schema.Boolean,
};

/**
 * The user's subjects in tree order, each with its cost this year per month, or its dates, in the
 * user's currency.
 */
export const getSubjects = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(listSubjects(context.owner, context.currency)));

/** One subject's page for a year or all time; one the user does not have comes back as a code. */
export const getSubject = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ subjectId: SubjectId, period: SubjectPeriod })),
  )
  .handler(({ data, context }) =>
    runCore(
      showSubject(
        context.owner,
        data.subjectId,
        context.currency,
        data.period === "all" ? "all" : { year: data.period },
      ).pipe(
        Effect.map((subject) => ({ ok: true as const, subject })),
        Effect.catchTags(REFUSALS),
      ),
    ),
  );

/**
 * What the past expenses of some merchants come to, before a subject gets them: for a subject that
 * exists, those it has not yet nor declined, what saving with "Attach them" attaches.
 */
export const getSubjectMerchantsPreview = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        merchantIds: Schema.Array(Id).check(Schema.isMaxLength(MAX_ATTACHED)),
        subjectId: Schema.NullOr(SubjectId),
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      subjectMerchantsPreview(
        context.owner,
        data.merchantIds,
        context.currency,
        data.subjectId,
      ).pipe(
        Effect.map((preview) => ({ ok: true as const, preview })),
        Effect.catchTags({ MerchantNotFound: () => refused("MERCHANT_NOT_FOUND") }),
      ),
    ),
  );

/** Those of a new subject: its options, a sibling's name, and its merchants' rules. */
const CREATE_REFUSALS = {
  SubjectRefused: REFUSALS.SubjectRefused,
  SubjectNameTaken: () => refused("SUBJECT_NAME_TAKEN"),
  MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
  TooManyRules: (refusal: { readonly limit: number }) => refused("TOO_MANY_RULES", refusal.limit),
};

/** Those of a change: a new subject's, and the subject gone. */
const SAVE_REFUSALS = { ...CREATE_REFUSALS, SubjectNotFound: REFUSALS.SubjectNotFound };

/** Makes a subject from its sheet; with merchants, a rule each, and their past when asked. */
export const createSubject = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct(SubjectFields)))
  .handler(({ data, context }) =>
    runCore(
      createCoreSubject(context.owner, data).pipe(
        Effect.map((subject) => ({ ok: true as const, subject })),
        Effect.catchTags(CREATE_REFUSALS),
      ),
    ),
  );

/** Changes a subject from its sheet: its options, its links, its merchants, archived or not. */
export const editSubject = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ subjectId: SubjectId, ...SubjectFields, archived: Schema.Boolean }),
    ),
  )
  .handler(({ data, context }) => {
    const { subjectId, ...edit } = data;

    return runCore(
      editCoreSubject(context.owner, subjectId, edit).pipe(
        Effect.map((subject) => ({ ok: true as const, subject })),
        Effect.catchTags(SAVE_REFUSALS),
      ),
    );
  });

const Expenses = Schema.Struct({
  subjectId: SubjectId,
  entryIds: Schema.Array(Id).check(Schema.isMaxLength(MAX_ATTACHED)),
});

/** Confirms a dated subject's proposals: the expenses are attached to it. */
export const attachSubjectExpenses = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Expenses))
  .handler(({ data, context }) =>
    runCore(
      attachSubject(context.owner, data.subjectId, data.entryIds).pipe(
        Effect.map((attachment) => ({ ok: true as const, attachment })),
        Effect.catchTags(EXPENSE_REFUSALS),
      ),
    ),
  );

/**
 * Attaches one expense to a subject, or with `remove` takes it off (#37): a line's detail, its "+
 * Add" and its chips. Refused with a code: a subject gone, or archived for an attachment; an
 * expense gone, or an income.
 */
export const setExpenseSubject = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ subjectId: SubjectId, entryId: Id, remove: Schema.Boolean }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      attachSubject(context.owner, data.subjectId, [data.entryId], { remove: data.remove }).pipe(
        Effect.map((attachment) => ({ ok: true as const, attachment })),
        Effect.catchTags(EXPENSE_REFUSALS),
      ),
    ),
  );

/** Declines a dated subject's proposals ("Not for this subject"): never proposed for it again. */
export const declineSubjectProposals = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Expenses))
  .handler(({ data, context }) =>
    runCore(
      refuseProposals(context.owner, data.subjectId, data.entryIds).pipe(
        Effect.map((refusal) => ({ ok: true as const, refusal })),
        Effect.catchTags(EXPENSE_REFUSALS),
      ),
    ),
  );
