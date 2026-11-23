import { useId, useState } from "react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import type { RuleConditions, RuleConditionsDraft } from "../lib/rule-fields";
import { ruleDay } from "../lib/rule-sentence";
import type { RuleAccountName } from "../lib/rule-sentence";
import { Button } from "./button";
import { CategoryPicker } from "./category-picker";
import type { CategoryChoice } from "./category-picker";
import { Checkbox } from "./checkbox";
import { Combobox } from "./combobox";
import { AlertDialog } from "./dialog";
import { FormMessage } from "./form-message";
import { Loader } from "./loader";
import { RuleConditionsEditor } from "./rule-conditions";
import type { RuleConditionError } from "./rule-conditions";
import { SegmentedChoice } from "./segmented-choice";
import { Sheet } from "./sheet";
import { Switch } from "./switch";

export type { RuleConditionError } from "./rule-conditions";

/** The kind of a rule's category: the kind of the lines it classifies follows it. */
export type RuleKind = "expense" | "income";

/** A rule's category as it is now, archived or not. */
export type RuleEditorCategory = {
  id: string;
  /** Its path, "Food › Groceries". */
  name: string;
  kind: RuleKind;
  archived: boolean;
};

/** The rule as the editor holds it, sent on each change and on Save. */
export type RuleDraft = {
  /** As the editor holds them: the page reads them with the server's checks. */
  conditions: RuleConditionsDraft;
  merchantId: string | null;
  categoryId: string | null;
  enabled: boolean;
  /** Lines classified otherwise by hand are changed too when it is applied to the past. */
  includeByHand: boolean;
  /** A new rule: applied to the lines already there once made. */
  applyToPast: boolean;
};

/** What the rule would do to the lines already there, as the page last read it. */
export type RuleReachView =
  | { state: "incomplete" }
  | { state: "loading" }
  | { state: "known"; lines: number; toChange: number; byHand: number };

/** The rule applied to the past: not asked, under way, done with its count, or failed. */
export type RuleApplyView =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; changed: number }
  | { state: "failed" };

export type RuleEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rule as saved, none for a new one. A new opening changes the editor's `key`. */
  rule: { place: number; createdFrom: "correction" | "user"; createdAt: string } | null;
  /** Its conditions as saved, none for a new rule (one condition on the label to fill in). */
  conditions: RuleConditions | null;
  merchantId: string | null;
  category: RuleEditorCategory | null;
  enabled: boolean;
  /** The most conditions a rule may have, and the longest piece of label: the server's limits. */
  maxConditions: number;
  maxLabelText: number;
  /** The accounts a condition may name, as the page calls them. */
  accounts: ReadonlyArray<RuleAccountName>;
  /** The user's currency: how many decimals an amount is typed with. */
  currency: string;
  /** The merchants it may set, by name; the rule's own among them. */
  merchants: ReadonlyArray<{ id: string; name: string }>;
  /** The categories in use of each kind, top-level ones with their children. */
  categories: { expense: ReadonlyArray<CategoryChoice>; income: ReadonlyArray<CategoryChoice> };
  reach: RuleReachView;
  /** Each change of the draft, for the page to read its reach again. */
  onDraftChange?: (draft: RuleDraft) => void;
  /** Saves the draft; the page says a refusal with `error` or `conditionError`. */
  onSave: (draft: RuleDraft) => Promise<void>;
  /** Deletes the rule, once confirmed; none for a new rule. */
  onDelete?: () => Promise<void>;
  /** The rule applied to the past from here; none for a new rule. */
  apply?: RuleApplyView;
  onApply?: (includeByHand: boolean) => Promise<void>;
  /** The server's refusal, under the form. */
  error?: string;
  /** The server's refusal of one condition, under it. */
  conditionError?: RuleConditionError;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

type Kind = RuleKind | "none";

/** A new rule's draft starts with one condition on its label, to fill in. */
const FIRST_CONDITION: RuleConditionsDraft = {
  kind: "group",
  combinator: "and",
  children: [{ kind: "rule", field: "label", operator: "contains", value: "" }],
};

/**
 * A rule, new or saved, in a side sheet (docs/wireframes, screen 9, blocks 3 and 4): "If" its
 * conditions, "Then" the merchant and the category it sets (the kind follows the category), whether
 * it is on, and its "Effect" on the lines already there, before saving: how many it applies to and
 * how many of those were classified otherwise by hand, which it changes only when "Reclassify them
 * too" is ticked. A saved rule is applied to the past from here, the count of the lines changed
 * said once done; a new one asks whether to apply it once made. "Delete" asks first.
 *
 * Motion: the sheet slides in from the right in about 300 ms (`Sheet`, from the bottom on a
 * phone); a condition added fades and slides in 150 ms (`RuleConditionsEditor`); the lines changed fade
 * in 200 ms once the job ends; "Delete"'s question grows in 200 ms (`AlertDialog`). Cut under
 * reduced motion.
 */
export function RuleEditor(props: RuleEditorProps) {
  const messages = useUiMessages().rules;
  const pageLocale = usePageLanguage();
  const locale = props.locale ?? pageLocale;
  const { rule, category } = props;

  const [draft, setDraft] = useState<RuleDraft>(() => ({
    conditions: props.conditions ?? FIRST_CONDITION,
    merchantId: props.merchantId,
    categoryId: category?.id ?? null,
    enabled: props.enabled,
    includeByHand: false,
    applyToPast: true,
  }));

  const [kind, setKind] = useState<Kind>(
    category?.kind ?? (props.merchantId === null ? "expense" : "none"),
  );

  // Changed since it opened (a change undone counts too): applying to the past applies the rule
  // as it is saved, so a change waits for Save first.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);

    try {
      await props.onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const change = (patch: Partial<RuleDraft>) => {
    const next = { ...draft, ...patch };

    setDraft(next);
    props.onDraftChange?.(next);
  };

  const edit = (patch: Partial<RuleDraft>) => {
    setDirty(true);
    change(patch);
  };

  const title = rule === null ? messages.newTitle : messages.titleOf(rule.place);

  const description =
    rule === null
      ? undefined
      : (rule.createdFrom === "correction" ? messages.createdByCorrection : messages.createdByHand)(
          ruleDay(rule.createdAt.slice(0, 10), locale),
        );

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title}
      description={description}
      size="lg"
      // A long form (docs/design.md, "Actions and forms"): Cancel, Delete apart on the left, Save.
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      actions={
        <>
          {props.onDelete === undefined ? null : (
            <div className="flex sm:order-first sm:me-auto">
              <AlertDialog
                trigger={<Button variant="secondary">{messages.delete}</Button>}
                title={messages.deleteTitle}
                description={messages.deleteDescription}
                confirmLabel={messages.delete}
                destructive
                onConfirm={props.onDelete}
              />
            </div>
          )}
          <Button type="submit" loading={saving}>
            {messages.save}
          </Button>
        </>
      }
    >
      <div data-slot="rule-editor" className="flex flex-col gap-6">
        <Section title={messages.if}>
          <RuleConditionsEditor
            initial={props.conditions}
            onChange={(conditions) => edit({ conditions })}
            accounts={props.accounts}
            currency={props.currency}
            maxConditions={props.maxConditions}
            maxLabelText={props.maxLabelText}
            error={props.conditionError}
          />
        </Section>
        <Section title={messages.then}>
          <ThenFields
            draft={draft}
            kind={kind}
            category={category}
            merchants={props.merchants}
            categories={props.categories}
            onKindChange={(next) => {
              setKind(next);
              // A category of the other kind cannot be kept.
              edit({ categoryId: next === category?.kind ? category.id : null });
            }}
            onEdit={edit}
          />
        </Section>
        <Section title={messages.effect}>
          <EffectBox
            saved={rule !== null}
            reach={props.reach}
            draft={draft}
            dirty={dirty}
            apply={props.apply ?? { state: "idle" }}
            locale={locale}
            onChange={change}
            onApply={() => props.onApply?.(draft.includeByHand)}
          />
        </Section>
        <FormMessage message={props.error} />
      </div>
    </Sheet>
  );
}

/** "Then": the merchant and the category the rule sets, and whether it is on. */
function ThenFields({
  draft,
  kind,
  category,
  merchants,
  categories,
  onKindChange,
  onEdit,
}: Pick<RuleEditorProps, "category" | "merchants" | "categories"> & {
  draft: RuleDraft;
  kind: Kind;
  onKindChange: (kind: Kind) => void;
  onEdit: (patch: Partial<RuleDraft>) => void;
}) {
  const messages = useUiMessages().rules;
  const archived = category !== null && category.archived ? category : null;
  const offered = kind === "none" ? [] : categories[kind];

  // The rule's category stays shown when archived (it keeps it), never offered to others.
  const choices =
    archived !== null && archived.kind === kind
      ? [...offered, { id: archived.id, name: archived.name }]
      : offered;

  return (
    <>
      <Combobox
        label={messages.merchant}
        description={messages.merchantNone}
        placeholder={messages.merchantPlaceholder}
        items={merchants.map((merchant) => ({ value: merchant.id, label: merchant.name }))}
        value={draft.merchantId}
        onValueChange={(merchantId) => onEdit({ merchantId })}
      />
      <SegmentedChoice
        label={messages.kind}
        value={kind}
        choices={[
          { value: "expense", label: messages.kindExpense },
          { value: "income", label: messages.kindIncome },
          { value: "none", label: messages.kindNone },
        ]}
        onChange={onKindChange}
      />
      {kind === "none" ? null : (
        <CategoryPicker
          label={messages.category}
          placeholder={messages.categoryPlaceholder}
          categories={choices}
          value={draft.categoryId}
          onValueChange={(categoryId) => onEdit({ categoryId })}
          description={
            archived !== null && draft.categoryId === archived.id
              ? messages.categoryArchived(archived.name)
              : undefined
          }
        />
      )}
      <Switch
        label={messages.enabled}
        description={messages.enabledDescription}
        checked={draft.enabled}
        onCheckedChange={(enabled) => onEdit({ enabled })}
      />
    </>
  );
}

/**
 * "Effect": what the rule would do to the lines already there, "Reclassify them too" when some
 * were classified by hand, and applying it to the past: at once for a saved rule, once made for a
 * new one.
 */
function EffectBox({
  saved,
  reach,
  draft,
  dirty,
  apply,
  locale,
  onChange,
  onApply,
}: {
  saved: boolean;
  reach: RuleReachView;
  draft: RuleDraft;
  dirty: boolean;
  apply: RuleApplyView;
  locale: string;
  onChange: (patch: Partial<RuleDraft>) => void;
  onApply: () => Promise<void> | undefined;
}) {
  const messages = useUiMessages().rules;
  const known = reach.state === "known" ? reach : null;

  return (
    <div data-slot="rule-effect" className="flex flex-col gap-3 rounded-lg bg-muted p-3">
      <Reach reach={reach} locale={locale} />
      {known !== null && known.byHand > 0 ? (
        <Checkbox
          label={messages.reclassify}
          checked={draft.includeByHand}
          onCheckedChange={(includeByHand) => onChange({ includeByHand })}
        />
      ) : null}
      {saved ? <ApplyToPast apply={apply} dirty={dirty} locale={locale} onApply={onApply} /> : null}
      {!saved && known !== null && known.toChange > 0 ? (
        <Checkbox
          label={messages.proposal.apply(known.toChange, formatCount(known.toChange, locale))}
          checked={draft.applyToPast}
          onCheckedChange={(applyToPast) => onChange({ applyToPast })}
        />
      ) : null}
    </div>
  );
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

/** How many lines already there the rule applies to, and how many were classified by hand. */
function Reach({ reach, locale }: { reach: RuleReachView; locale: string }) {
  const messages = useUiMessages();
  const rules = messages.rules;

  switch (reach.state) {
    case "incomplete":
      return <p className="text-sm text-muted-foreground">{rules.reachIncomplete}</p>;
    case "loading":
      return (
        <p className="flex h-5 items-center gap-2 text-sm text-muted-foreground">
          <Loader size="sm" />
          {messages.loading}
        </p>
      );
    case "known":
      return (
        <p data-slot="rule-reach" className="text-sm text-foreground">
          {rules.reach(reach.lines, formatCount(reach.lines, locale))}
          {reach.byHand > 0 ? (
            <> {rules.byHand(reach.byHand, formatCount(reach.byHand, locale))}</>
          ) : null}
        </p>
      );
  }
}

/** "Apply to the past" and where it stands: under way, the lines changed, or a failure. */
function ApplyToPast({
  apply,
  dirty,
  locale,
  onApply,
}: {
  apply: RuleApplyView;
  dirty: boolean;
  locale: string;
  onApply: () => Promise<void> | undefined;
}) {
  const messages = useUiMessages().rules;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={dirty}
          loading={apply.state === "running"}
          loadingLabel={messages.applying}
          onClick={() => onApply()}
        >
          {messages.apply}
        </Button>
        <p
          role="status"
          data-slot="rule-applied"
          className="text-sm text-foreground duration-200 ease-out animate-in fade-in"
          key={apply.state}
        >
          {apply.state === "done"
            ? messages.changed(apply.changed, formatCount(apply.changed, locale))
            : null}
        </p>
      </div>
      {dirty ? <p className="text-xs text-muted-foreground">{messages.saveFirst}</p> : null}
      {apply.state === "failed" ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {messages.applyFailed}
        </p>
      ) : null}
    </div>
  );
}
