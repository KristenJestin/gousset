import type { RuleDetail } from "@gousset/core";
import { MAX_CONDITIONS, MAX_LABEL_TEXT } from "@gousset/core/rule-values";
import { m } from "@gousset/i18n/messages";
import { RuleEditor } from "@gousset/ui/components/rule-editor";
import type {
  RuleConditionError,
  RuleDraft,
  RuleReachView,
} from "@gousset/ui/components/rule-editor";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { notify } from "@gousset/ui/lib/notify";
import type { RuleAccountName } from "@gousset/ui/lib/rule-sentence";
import { useDebouncer } from "@tanstack/react-pacer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useRuleJob } from "@/components/rule-job";
import { applyRuleToPast, createRule, deleteRule, editRule } from "@/functions/rules";
import type { getRuleReach } from "@/functions/rules";
import { ruleRefusalMessage } from "@/i18n/messages";
import { categoryPath, choicesOf } from "@/lib/categories";
import { conditionsOf, drawnConditions } from "@/lib/rule-conditions";
import { categoryQueries } from "@/queries/categories";
import { merchantQueries } from "@/queries/merchants";
import { invalidateRules, ruleQueries } from "@/queries/rules";
import type { RuleReachDraft } from "@/queries/rules";

/** How long the effect waits for the typing to stop before it is read again. */
const TYPING_WAIT_MS = 300;

/** A call that failed outright, as a refusal the editor can say. */
const FAILED = { ok: false as const, code: "UNKNOWN", index: null, limit: null };

/** A failed call answers a refusal: the React Compiler has no `try` to handle in a component. */
function answerOf<Answer>(call: Promise<Answer>): Promise<Answer | typeof FAILED> {
  return call.then(
    (answer) => answer,
    () => FAILED,
  );
}

/** A refusal: under the condition it is about, else under the form. */
type Refusal = { form: string | undefined; condition: RuleConditionError | undefined };

const NO_REFUSAL: Refusal = { form: undefined, condition: undefined };

function refusalOf(answer: { code: string; index: number | null; limit: number | null }): Refusal {
  const message = ruleRefusalMessage(answer.code, answer.index, answer.limit);

  return answer.index === null
    ? { form: message, condition: undefined }
    : { form: undefined, condition: { index: answer.index, message } };
}

export type RuleSheetProps = {
  /** The rule to edit, or none for a new one. */
  ruleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: ReadonlyArray<RuleAccountName>;
  /** The user's currency: how many decimals an amount is typed with. */
  currency: string;
  /** A new rule was applied to the past: its job, which the page follows once the sheet closes. */
  onApplied: (jobId: string) => void;
};

/**
 * A rule in its side sheet (#25; docs/wireframes, screen 9, blocks 3 and 4): a saved one once read,
 * with its effect on the lines already there, or a new one. The effect is read again once the typing
 * stops; Save, Delete and "Apply to the past" go to the server, a refusal said where it applies.
 */
export function RuleSheet(props: RuleSheetProps) {
  const detail = useQuery({
    ...ruleQueries.detail(props.ruleId ?? ""),
    enabled: props.ruleId !== null,
    // Read anew at each opening: the editor starts from what it is given, and a rule saved a
    // moment ago must not open as it was before.
    refetchOnMount: "always",
  });

  if (props.ruleId === null) {
    return <RuleSheetEditor {...props} rule={null} />;
  }

  // The sheet opens once the rule is read, so that it opens filled.
  return detail.isFetchedAfterMount && detail.data?.ok === true ? (
    <RuleSheetEditor {...props} rule={detail.data.rule} />
  ) : null;
}

function RuleSheetEditor({
  rule,
  open,
  onOpenChange,
  accounts,
  currency,
  onApplied,
}: RuleSheetProps & { rule: RuleDetail | null }) {
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const { data: tree } = useQuery(categoryQueries.list());
  const { data: merchants = [] } = useQuery(merchantQueries.choices());
  const [refusal, setRefusal] = useState(NO_REFUSAL);
  // What the effect is read for once the typing stops; none while a condition is incomplete.
  const [reachFor, setReachFor] = useState<RuleReachDraft | null>(null);
  const [edited, setEdited] = useState(false);
  const typing = useDebouncer(setReachFor, { wait: TYPING_WAIT_MS });
  const [jobId, setJobId] = useState<string>();
  const apply = useRuleJob(jobId);

  const preview = useQuery({
    ...ruleQueries.reach(
      reachFor ?? { conditions: emptyConditions(), merchantId: null, categoryId: null },
      // A saved rule's own lines are no change of a draft of it.
      rule?.id ?? null,
    ),
    enabled: reachFor !== null,
  });

  const reach = reachOf(rule, edited, reachFor, preview.data);

  // The rule's merchant stays offered when it is past the picker's first names.
  const own = rule?.merchant ?? null;

  const offered =
    own === null || merchants.some(({ id }) => id === own.id) ? merchants : [...merchants, own];

  const close = () => onOpenChange(false);

  async function save(draft: RuleDraft) {
    const conditions = conditionsOf(draft.conditions);

    if (conditions === null) {
      setRefusal({ form: m.ruleRefusalIncomplete(), condition: undefined });

      return;
    }

    const sets = { merchantId: draft.merchantId, categoryId: draft.categoryId };

    const answer = await answerOf(
      rule === null
        ? createRule({
            data: { conditions, ...sets, enabled: draft.enabled, createdFrom: "user" },
          })
        : editRule({ data: { ruleId: rule.id, conditions, ...sets, enabled: draft.enabled } }),
    );

    if (!answer.ok) {
      setRefusal(refusalOf(answer));

      return;
    }

    setRefusal(NO_REFUSAL);
    await invalidateRules(queryClient);

    const made = rule === null;
    const toChange = reach.state === "known" ? reach.toChange : 0;

    if (made && draft.applyToPast && toChange > 0) {
      const started = await answerOf(
        applyRuleToPast({ data: { ruleId: answer.rule.id, includeByHand: draft.includeByHand } }),
      );

      if (started.ok) {
        onApplied(started.jobId);
      } else {
        notify.failed({ description: ruleRefusalMessage(started.code) });
      }
    } else {
      notify.saved({ description: made ? m.rulesCreated() : m.rulesSaved() });
    }

    close();
  }

  async function remove(ruleId: string) {
    const answer = await answerOf(deleteRule({ data: { ruleId } }));

    if (!answer.ok) {
      notify.failed({ description: ruleRefusalMessage(answer.code) });

      return;
    }

    await invalidateRules(queryClient);
    notify.saved({ description: m.rulesDeleted() });
    close();
  }

  async function applyToPast(ruleId: string, includeByHand: boolean) {
    const started = await answerOf(applyRuleToPast({ data: { ruleId, includeByHand } }));

    if (started.ok) {
      setRefusal(NO_REFUSAL);
      setJobId(started.jobId);
    } else {
      setRefusal(refusalOf(started));
    }
  }

  return (
    <RuleEditor
      open={open}
      onOpenChange={onOpenChange}
      rule={
        rule === null
          ? null
          : { place: rule.place, createdFrom: rule.createdFrom, createdAt: rule.createdAt }
      }
      conditions={rule === null ? null : drawnConditions(rule.conditions)}
      merchantId={rule?.merchant?.id ?? null}
      category={
        rule === null || rule.category === null
          ? null
          : {
              id: rule.category.id,
              name: categoryPath(rule.category),
              kind: rule.category.kind,
              archived: rule.category.archived,
            }
      }
      enabled={rule?.enabled ?? true}
      maxConditions={MAX_CONDITIONS}
      maxLabelText={MAX_LABEL_TEXT}
      accounts={accounts}
      currency={currency}
      merchants={offered}
      categories={{
        expense: tree === undefined ? [] : choicesOf(tree, "expense"),
        income: tree === undefined ? [] : choicesOf(tree, "income"),
      }}
      reach={reach}
      onDraftChange={(draft) => {
        const conditions = conditionsOf(draft.conditions);

        setEdited(true);
        setRefusal(NO_REFUSAL);
        typing.maybeExecute(
          conditions === null
            ? null
            : { conditions, merchantId: draft.merchantId, categoryId: draft.categoryId },
        );
      }}
      onSave={save}
      onDelete={rule === null ? undefined : async () => remove(rule.id)}
      apply={apply}
      onApply={
        rule === null ? undefined : async (includeByHand) => applyToPast(rule.id, includeByHand)
      }
      error={refusal.form}
      conditionError={refusal.condition}
      locale={locale}
    />
  );
}

/** A draft with no condition: what the reach's query is keyed on while it waits for one. */
function emptyConditions(): RuleReachDraft["conditions"] {
  return { kind: "group", combinator: "and", children: [] };
}

/**
 * What the editor says of the effect: a saved rule's own until it is edited, then the draft's once
 * read; nothing while a condition is incomplete, or what is set is refused.
 */
function reachOf(
  rule: RuleDetail | null,
  edited: boolean,
  reachFor: RuleReachDraft | null,
  read: Awaited<ReturnType<typeof getRuleReach>> | undefined,
): RuleReachView {
  if (rule !== null && !edited) {
    return { state: "known", ...rule.reach };
  }

  if (reachFor === null) {
    return { state: "incomplete" };
  }

  if (read === undefined) {
    return { state: "loading" };
  }

  return read.ok ? { state: "known", ...read.reach } : { state: "incomplete" };
}
