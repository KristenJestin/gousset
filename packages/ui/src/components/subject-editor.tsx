import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { CURRENCY_CODES } from "../lib/money";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Combobox } from "./combobox";
import { DatePicker } from "./date-picker";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";
import { Loader } from "./loader";
import { MoneyField } from "./money-field";
import { Select } from "./select";
import { Sheet } from "./sheet";
import { TextField } from "./text-field";

/** A subject as its sheet holds it, sent on each change and on save. */
export type SubjectDraft = {
  name: string;
  /** The subject it is inside; none at the top. */
  parentId: string | null;
  hasValue: boolean;
  /** With `hasValue`: in minor units of `valueCurrency`; none while not typed. */
  valueMinor: number | null;
  valueCurrency: string;
  /** With `hasValue`: one of the user's loan accounts; none without. */
  loanAccountId: string | null;
  hasDates: boolean;
  /** With `hasDates`: ISO days; the end none while it goes on. */
  startsOn: string | null;
  endsOn: string | null;
  accountIds: ReadonlyArray<string>;
  /** Each becomes a rule "merchant is", attaching the subject. */
  merchantIds: ReadonlyArray<string>;
  /** The past expenses of the merchants added are attached once saved. */
  attachPast: boolean;
  archived: boolean;
};

/** A refusal said under the field at fault, or under the form. */
export type SubjectEditorErrors = {
  name?: string;
  parent?: string;
  value?: string;
  loan?: string;
  dates?: string;
  accounts?: string;
  merchants?: string;
  form?: string;
};

/** What the past expenses of the merchants added come to, as the page last read it. */
export type SubjectPastView =
  | { state: "none" }
  | { state: "loading" }
  | { state: "known"; expenses: number; total: string };

type Named = { id: string; name: string };

export type SubjectEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The subject being edited, by its name; none for a new one. */
  editing: string | null;
  /** The draft it opens with. A new opening changes the editor's `key`. */
  initial: SubjectDraft;
  /** The subjects it may go inside, by their paths ("House > Garden shed"): none of its own. */
  parents: ReadonlyArray<Named>;
  /** The user's loan accounts. */
  loans: ReadonlyArray<Named>;
  /** The accounts it may be linked to. */
  accounts: ReadonlyArray<Named>;
  /** The merchants it may attach, by name; its own among them. */
  merchants: ReadonlyArray<Named>;
  past: SubjectPastView;
  /** Each change of the draft, for the page to read the past expenses again. */
  onDraftChange?: (draft: SubjectDraft) => void;
  /** Sends the draft; the page says a refusal with `errors`, and closes the sheet once accepted. */
  onSave: (draft: SubjectDraft) => Promise<void>;
  errors?: SubjectEditorErrors;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
  /** Where focus goes once it closes, before what opened it (`Sheet`'s `finalFocus`). */
  finalFocus?: string;
};

const TOP = "top";
const NO_LOAN = "none";

const CURRENCY_ITEMS = CURRENCY_CODES.map((code) => ({ value: code, label: code }));

/**
 * A subject, new or saved, in a side sheet (docs/wireframes, screen 8; docs/design.md, "A long
 * form"): its name and the subject it is inside, "Has a value" (an estimated value in a currency,
 * the loan it is bought with), "Has dates" (its start and end), the accounts linked to it, the
 * merchants that attach their expenses automatically (each a rule), and their past expenses, which
 * it offers to attach at once; a saved one may be archived or restored. It opens on its name. While
 * it is sent it stays open, its button busy; a refusal is said under the field at fault.
 *
 * Motion: the sheet slides in from the right in 300 ms, ease-out, and out in 200 ms, ease-in; from
 * the bottom on a phone; its backdrop fades in 200 ms (`Sheet`). Cut under reduced motion.
 */
export function SubjectEditor(props: SubjectEditorProps) {
  const messages = useUiMessages().subjects;
  const pageLocale = usePageLanguage();
  const locale = props.locale ?? pageLocale;
  const errors = props.errors ?? {};
  const [draft, setDraft] = useState<SubjectDraft>(props.initial);
  const [saving, setSaving] = useState(false);
  const linked = new Set(draft.accountIds);

  const change = (patch: Partial<SubjectDraft>) => {
    const next = { ...draft, ...patch };

    setDraft(next);
    props.onDraftChange?.(next);
  };

  const save = async () => {
    setSaving(true);

    try {
      await props.onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.editing === null ? messages.newTitle : messages.editTitle(props.editing)}
      sending={saving}
      finalFocus={props.finalFocus}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      actions={
        <Button type="submit" loading={saving}>
          {props.editing === null ? messages.create : messages.save}
        </Button>
      }
    >
      <div data-slot="subject-editor" className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <TextField
            label={messages.name}
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
            error={errors.name}
            required
            autoComplete="off"
          />
          <Select
            label={messages.inside}
            items={[
              { value: TOP, label: messages.none },
              ...props.parents.map((parent) => ({ value: parent.id, label: parent.name })),
            ]}
            value={draft.parentId ?? TOP}
            onValueChange={(value) => change({ parentId: value === TOP ? null : value })}
            error={errors.parent}
          />
        </div>
        <Options draft={draft} loans={props.loans} errors={errors} onChange={change} />
        <Section title={messages.accounts}>
          {props.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{messages.accountsNone}</p>
          ) : (
            <div className="flex flex-col gap-2" data-slot="subject-accounts">
              {props.accounts.map((account) => (
                <Checkbox
                  key={account.id}
                  label={account.name}
                  checked={linked.has(account.id)}
                  onCheckedChange={(checked) =>
                    change({
                      accountIds: checked
                        ? [...draft.accountIds, account.id]
                        : draft.accountIds.filter((id) => id !== account.id),
                    })
                  }
                />
              ))}
            </div>
          )}
          {errors.accounts === undefined ? null : <FormMessage message={errors.accounts} />}
        </Section>
        <Section title={messages.attachAutomatically}>
          <MerchantsField
            chosen={draft.merchantIds}
            merchants={props.merchants}
            onChange={(merchantIds) => change({ merchantIds })}
          />
          {errors.merchants === undefined ? null : <FormMessage message={errors.merchants} />}
        </Section>
        <Section title={messages.past}>
          <PastExpenses
            past={props.past}
            attachPast={draft.attachPast}
            locale={locale}
            onChange={(attachPast) => change({ attachPast })}
          />
        </Section>
        {props.editing === null ? null : (
          <Checkbox
            label={messages.archivedSwitch}
            description={messages.archivedDescription}
            checked={draft.archived}
            onCheckedChange={(archived) => change({ archived })}
          />
        )}
        <FormMessage message={errors.form} />
      </div>
    </Sheet>
  );
}

/** "Has a value" and "Has dates", each with its fields once ticked. */
function Options({
  draft,
  loans,
  errors,
  onChange,
}: {
  draft: SubjectDraft;
  loans: ReadonlyArray<Named>;
  errors: SubjectEditorErrors;
  onChange: (patch: Partial<SubjectDraft>) => void;
}) {
  const messages = useUiMessages().subjects;

  return (
    <div data-slot="subject-options" className="flex flex-col gap-4 rounded-lg bg-muted p-3">
      <Checkbox
        label={messages.hasValue}
        description={messages.hasValueDescription}
        checked={draft.hasValue}
        onCheckedChange={(hasValue) => onChange({ hasValue })}
      />
      {draft.hasValue ? (
        <div className="flex flex-col gap-3 ps-7">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <MoneyField
                label={messages.valueField}
                currency={draft.valueCurrency}
                value={draft.valueMinor}
                onValueChange={(valueMinor) => onChange({ valueMinor })}
                error={errors.value}
              />
            </div>
            <div className="w-28 shrink-0">
              <Combobox
                label={messages.currency}
                items={CURRENCY_ITEMS}
                value={draft.valueCurrency}
                onValueChange={(currency) =>
                  onChange({ valueCurrency: currency ?? draft.valueCurrency })
                }
              />
            </div>
          </div>
          <Select
            label={messages.loanField}
            items={[
              { value: NO_LOAN, label: messages.none },
              ...loans.map((loan) => ({ value: loan.id, label: loan.name })),
            ]}
            value={draft.loanAccountId ?? NO_LOAN}
            onValueChange={(value) => onChange({ loanAccountId: value === NO_LOAN ? null : value })}
            error={errors.loan}
          />
        </div>
      ) : null}
      <Checkbox
        label={messages.hasDates}
        description={messages.hasDatesDescription}
        checked={draft.hasDates}
        onCheckedChange={(hasDates) => onChange({ hasDates })}
      />
      {draft.hasDates ? (
        <div className="flex flex-col gap-3 ps-7">
          <DatePicker
            label={messages.startsOn}
            value={draft.startsOn}
            onValueChange={(startsOn) => onChange({ startsOn })}
            error={errors.dates}
          />
          <DatePicker
            label={messages.endsOn}
            description={messages.endsOnDescription}
            value={draft.endsOn}
            min={draft.startsOn ?? undefined}
            onValueChange={(endsOn) => onChange({ endsOn })}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The merchants chosen, as chips each with its remove button, and "+ Merchant" to add one. */
function MerchantsField({
  chosen,
  merchants,
  onChange,
}: {
  chosen: ReadonlyArray<string>;
  merchants: ReadonlyArray<Named>;
  onChange: (merchantIds: ReadonlyArray<string>) => void;
}) {
  const ui = useUiMessages();
  const messages = ui.subjects;
  const [adding, setAdding] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const byId = new Map(merchants.map((merchant) => [merchant.id, merchant.name]));
  const taken = new Set(chosen);

  // The picker, once shown, has the focus: the press on "+ Merchant" asked for it.
  useEffect(() => {
    if (adding) {
      picker.current?.querySelector("input")?.focus();
    }
  }, [adding]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {chosen.length === 0 ? messages.noMerchant : messages.atMerchants}
      </p>
      <ul className="flex flex-wrap items-center gap-2" data-slot="subject-merchant-chips">
        {chosen.map((id) => {
          const name = byId.get(id) ?? id;

          return (
            <li
              key={id}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-muted ps-2.5 pe-0.5 text-xs font-medium"
            >
              <span className="truncate">{name}</span>
              <button
                type="button"
                aria-label={ui.pieces.remove(name)}
                onClick={() => onChange(chosen.filter((each) => each !== id))}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 ease-out hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Icon name="close" size="sm" />
              </button>
            </li>
          );
        })}
        {adding ? null : (
          <li className="flex">
            <Button variant="secondary" size="sm" icon="add" onClick={() => setAdding(true)}>
              {messages.addMerchant}
            </Button>
          </li>
        )}
      </ul>
      {adding ? (
        <div ref={picker}>
          <Combobox
            label={messages.merchantToAdd}
            placeholder={messages.merchantPlaceholder}
            items={merchants.flatMap((merchant) =>
              taken.has(merchant.id) ? [] : [{ value: merchant.id, label: merchant.name }],
            )}
            value={null}
            onValueChange={(id) => {
              if (id !== null) {
                onChange([...chosen, id]);
                setAdding(false);
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** What the merchants' past expenses come to, and "Attach them" once there are some. */
function PastExpenses({
  past,
  attachPast,
  locale,
  onChange,
}: {
  past: SubjectPastView;
  attachPast: boolean;
  locale: string;
  onChange: (attachPast: boolean) => void;
}) {
  const ui = useUiMessages();
  const messages = ui.subjects;

  switch (past.state) {
    case "none":
      return <p className="text-sm text-muted-foreground">{messages.pastEmpty}</p>;
    case "loading":
      return (
        <p className="flex h-5 items-center gap-2 text-sm text-muted-foreground">
          <Loader size="sm" />
          {ui.loading}
        </p>
      );
    case "known":
      return past.expenses === 0 ? (
        <p className="text-sm text-muted-foreground">{messages.pastNone}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p data-slot="subject-past" className="text-sm text-foreground">
            {messages.pastMatch(past.expenses, formatCount(past.expenses, locale), past.total)}
          </p>
          <Checkbox label={messages.attachThem} checked={attachPast} onCheckedChange={onChange} />
        </div>
      );
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
