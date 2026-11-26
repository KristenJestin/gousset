import type { SubjectDetail, SubjectList, SubjectSaved } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { SubjectEditor } from "@gousset/ui/components/subject-editor";
import type {
  SubjectDraft,
  SubjectEditorErrors,
  SubjectPastView,
} from "@gousset/ui/components/subject-editor";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { formatMoney } from "@gousset/ui/lib/money";
import { notify } from "@gousset/ui/lib/notify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createSubject, editSubject } from "@/functions/subjects";
import type { getSubjectMerchantsPreview } from "@/functions/subjects";
import { subjectRefusalMessage } from "@/i18n/messages";
import { pathsOf } from "@/lib/subjects";
import { accountQueries } from "@/queries/accounts";
import { merchantQueries } from "@/queries/merchants";
import { invalidateSubjects, subjectQueries } from "@/queries/subjects";

/** A call that failed outright, as a refusal the sheet can say. */
const FAILED = { ok: false as const, code: "UNKNOWN", limit: null };

/** A failed call answers a refusal: the React Compiler has no `try` to handle in a component. */
function answerOf<Answer>(call: Promise<Answer>): Promise<Answer | typeof FAILED> {
  return call.then(
    (answer) => answer,
    () => FAILED,
  );
}

/** The field a refusal is said under, by its code; the form's foot for the others. */
function fieldOf(code: string): keyof SubjectEditorErrors {
  switch (code) {
    case "SUBJECT_NAME":
    case "SUBJECT_NAME_TAKEN":
      return "name";
    case "SUBJECT_PARENT_MISSING":
    case "SUBJECT_PARENT_ARCHIVED":
    case "SUBJECT_CYCLE":
      return "parent";
    case "SUBJECT_VALUE":
      return "value";
    case "SUBJECT_LOAN":
      return "loan";
    case "SUBJECT_ACCOUNT":
      return "accounts";
    case "SUBJECT_DATES":
      return "dates";
    case "MERCHANT_NOT_FOUND":
    case "TOO_MANY_RULES":
      return "merchants";
    default:
      return "form";
  }
}

/** A refusal, under the field it is about. */
function errorsOf(code: string, limit: number | null): SubjectEditorErrors {
  const errors: SubjectEditorErrors = {};

  errors[fieldOf(code)] = subjectRefusalMessage(code, limit);

  return errors;
}

/** The draft a subject's sheet opens with: the subject as it is, or a new one in `currency`. */
function draftOf(subject: SubjectDetail | null, currency: string): SubjectDraft {
  if (subject === null) {
    return {
      name: "",
      parentId: null,
      hasValue: false,
      valueMinor: null,
      valueCurrency: currency,
      loanAccountId: null,
      hasDates: false,
      startsOn: null,
      endsOn: null,
      accountIds: [],
      merchantIds: [],
      // The user names the merchants: their past expenses are theirs too (docs/wireframes, 8).
      attachPast: true,
      archived: false,
    };
  }

  return {
    name: subject.name,
    parentId: subject.parentId,
    hasValue: subject.value !== null || subject.loan !== null,
    valueMinor: subject.value?.minor ?? null,
    valueCurrency: subject.value?.currency ?? currency,
    loanAccountId: subject.loan?.id ?? null,
    hasDates: subject.startsOn !== null,
    startsOn: subject.startsOn,
    endsOn: subject.endsOn,
    accountIds: subject.accounts.map((account) => account.id),
    merchantIds: subject.merchants.map((merchant) => merchant.id),
    attachPast: true,
    archived: subject.archived,
  };
}

/** What the sheet sends: what an option left unticked holds is sent as none. */
function inputOf(draft: SubjectDraft) {
  const valued = draft.hasValue && draft.valueMinor !== null;

  return {
    name: draft.name,
    parentId: draft.parentId,
    valueMinor: valued ? draft.valueMinor : null,
    valueCurrency: valued ? draft.valueCurrency : null,
    loanAccountId: draft.hasValue ? draft.loanAccountId : null,
    startsOn: draft.hasDates ? draft.startsOn : null,
    endsOn: draft.hasDates ? draft.endsOn : null,
    accountIds: [...draft.accountIds],
    merchantIds: [...draft.merchantIds],
    attachPast: draft.attachPast,
  };
}

export type SubjectSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The subject to edit, as its page read it; none for a new one. */
  subject: SubjectDetail | null;
  /** Every subject of the user's, in tree order: the open ones may hold it. */
  subjects: SubjectList["subjects"];
  /** The user's currency: a value's, unless another is chosen. */
  currency: string;
  /** Once accepted, as the sheet closes. */
  onSaved?: (saved: SubjectSaved) => void;
};

/**
 * A subject in its side sheet (#37; docs/wireframes, screen 8): a new one, or one of the user's to
 * change. It offers the subjects it may go inside (a cycle is the server's to refuse, under
 * "Inside"), the loan accounts, the accounts and the merchants; the past expenses of the merchants
 * added are read as they are added. A refusal is said under its field; once accepted, the sheet
 * closes and every subjects query is read again.
 */
export function SubjectSheet({
  open,
  onOpenChange,
  subject,
  subjects,
  currency,
  onSaved,
}: SubjectSheetProps) {
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const [initial] = useState(() => draftOf(subject, currency));
  const [merchantIds, setMerchantIds] = useState(initial.merchantIds);
  const [errors, setErrors] = useState<SubjectEditorErrors>({});
  const { data: accounts } = useQuery(accountQueries.list());
  const { data: merchants = [] } = useQuery(merchantQueries.choices());
  // Only the merchants added have their past to attach: those it had are attached already.
  const had = new Set(initial.merchantIds);
  const added = merchantIds.filter((id) => !had.has(id));
  const preview = useQuery(subjectQueries.preview(added));

  const openAccounts = accounts?.groups.flatMap((group) => group.accounts) ?? [];
  const linked = subject?.accounts ?? [];
  const stillOpen = new Set(openAccounts.map((account) => account.id));

  // The accounts it may be linked to: the open ones, and those it is linked to already.
  const offered = [
    ...openAccounts.map((account) => ({ id: account.id, name: account.name, kind: account.kind })),
    ...linked.flatMap((account) =>
      stillOpen.has(account.id) ? [] : [{ id: account.id, name: account.name, kind: account.kind }],
    ),
  ];

  const loans = offered.flatMap((account) =>
    account.kind === "loan" ? [{ id: account.id, name: account.name }] : [],
  );

  // A payment intermediary is never who was paid (#30): none is offered, but its own stay.
  const payees = new Set(merchants.flatMap((choice) => (choice.intermediary ? [] : [choice.id])));

  const offeredMerchants = [
    ...merchants.flatMap((choice) =>
      choice.intermediary ? [] : [{ id: choice.id, name: choice.name }],
    ),
    ...(subject?.merchants ?? []).filter((own) => !payees.has(own.id)),
  ];

  // It may go inside any open subject but itself; one of its own is the server's to refuse. Its
  // parent stays offered, archived since.
  const paths = pathsOf(subjects);

  const parents = subjects.flatMap((each) =>
    each.id === subject?.id || (each.archived && each.id !== subject?.parentId)
      ? []
      : [{ id: each.id, name: paths.get(each.id) ?? each.name }],
  );

  const past = pastOf(added, preview.data, locale);

  async function save(draft: SubjectDraft) {
    const input = inputOf(draft);

    const answer = await answerOf(
      subject === null
        ? createSubject({ data: input })
        : editSubject({ data: { subjectId: subject.id, ...input, archived: draft.archived } }),
    );

    if (!answer.ok) {
      setErrors(errorsOf(answer.code, answer.limit));

      return;
    }

    setErrors({});
    await invalidateSubjects(queryClient);
    notify.saved({
      description: (subject === null ? m.subjectsCreated : m.subjectsSaved)({
        name: answer.subject.name,
      }),
    });
    onOpenChange(false);
    onSaved?.(answer.subject);
  }

  return (
    <SubjectEditor
      open={open}
      onOpenChange={onOpenChange}
      editing={subject?.name ?? null}
      initial={initial}
      parents={parents}
      loans={loans}
      accounts={offered.map(({ id, name }) => ({ id, name }))}
      merchants={offeredMerchants}
      past={past}
      errors={errors}
      onDraftChange={(draft) => {
        setErrors({});
        setMerchantIds(draft.merchantIds);
      }}
      onSave={save}
      locale={locale}
    />
  );
}

/** What the sheet says of the past expenses of the merchants added. */
function pastOf(
  added: ReadonlyArray<string>,
  read: Awaited<ReturnType<typeof getSubjectMerchantsPreview>> | undefined,
  locale: string,
): SubjectPastView {
  if (added.length === 0) {
    return { state: "none" };
  }

  if (read === undefined) {
    return { state: "loading" };
  }

  if (!read.ok) {
    return { state: "none" };
  }

  const amounts = [read.preview.total, ...read.preview.elsewhere].map((amount) =>
    formatMoney(amount, { locale }),
  );

  return {
    state: "known",
    expenses: read.preview.expenses,
    total: new Intl.ListFormat(locale, { type: "conjunction" }).format(amounts),
  };
}
