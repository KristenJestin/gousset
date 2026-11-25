import { MAX_LABEL_TEXT } from "@gousset/core/rule-values";
import { RuleProposal } from "@gousset/ui/components/rule-proposal";
import type { RuleProposalAnswer, RuleProposalSets } from "@gousset/ui/components/rule-proposal";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { m } from "@gousset/i18n/messages";
import { notify } from "@gousset/ui/lib/notify";
import { useDebouncer } from "@tanstack/react-pacer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { applyRuleToPast, createRule } from "@/functions/rules";
import { ruleRefusalMessage } from "@/i18n/messages";
import { proposalConditions } from "@/lib/rule-conditions";
import { invalidateRules, ruleQueries } from "@/queries/rules";

/** How long the count waits for the typing to stop before it is read again. */
const TYPING_WAIT_MS = 300;

/**
 * What the rule sets: the category the line was just put in, by id and by its path ("Food ›
 * Groceries"), or the merchant a line paid through an intermediary was just given (#30), by id and
 * by name.
 */
export type ProposedRuleSets = {
  kind: "category" | "merchant";
  id: string;
  name: string;
};

export type ProposedRuleProps = {
  lineId: string;
  sets: ProposedRuleSets;
  /** The rule was applied to the past: its job, which the page follows. */
  onApplied: (jobId: string) => void;
};

/**
 * A correction proposes a rule (#25): once the line's category is changed, or the merchant of a
 * line paid through an intermediary is chosen (#30), "Make it a rule?", read from the server (the
 * line's cleaned label, or the intermediary through who was paid, and how many lines already there
 * it would change), opens; the count is read again as the words change. Made from a correction, it
 * is applied to the past, if asked, without touching a line classified by hand. Cancel changes
 * nothing. A proposal the server cannot make (a label of nothing to look for) is not offered.
 */
export function ProposedRule({ lineId, sets, onApplied }: ProposedRuleProps) {
  const queryClient = useQueryClient();
  const locale = usePageLanguage();

  const effect =
    sets.kind === "merchant"
      ? { merchantId: sets.id, categoryId: null }
      : { merchantId: null, categoryId: sets.id };

  const named: RuleProposalSets =
    sets.kind === "merchant" ? { merchant: sets.name } : { category: sets.name };

  const proposal = useQuery(ruleQueries.proposal(lineId, effect));
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string>();
  // The words typed, once the typing stops; none while they are the proposal's own.
  const [typed, setTyped] = useState<string | null>(null);
  const typing = useDebouncer(setTyped, { wait: TYPING_WAIT_MS });

  const preview = useQuery({
    ...ruleQueries.reach({ conditions: proposalConditions(typed ?? ""), ...effect }, null),
    enabled: typed !== null && typed.trim() !== "",
  });

  if (proposal.data === undefined || !proposal.data.ok) {
    return null;
  }

  const offered = proposal.data;

  const reach =
    typed === null
      ? offered.reach.toChange
      : preview.data?.ok === true
        ? preview.data.reach.toChange
        : null;

  async function create({ words, applyToPast }: RuleProposalAnswer) {
    const made = await createRule({
      data: {
        conditions: proposalConditions(words),
        ...effect,
        enabled: true,
        createdFrom: "correction",
      },
    }).catch(() => ({ ok: false as const, code: "UNKNOWN", index: null, limit: null }));

    if (!made.ok) {
      setError(ruleRefusalMessage(made.code, made.index, made.limit));

      return;
    }

    await invalidateRules(queryClient);

    if (applyToPast) {
      // A correction's rule leaves the lines classified by hand as they are.
      const started = await applyRuleToPast({
        data: { ruleId: made.rule.id, includeByHand: false },
      }).catch(() => ({ ok: false as const, code: "UNKNOWN" }));

      if (started.ok) {
        onApplied(started.jobId);
      } else {
        notify.failed({ description: ruleRefusalMessage(started.code) });
      }
    } else {
      notify.saved({ description: m.rulesCreated() });
    }

    setOpen(false);
  }

  return (
    <RuleProposal
      {...named}
      open={open}
      onOpenChange={setOpen}
      words={offered.words}
      onWordsChange={(words) => {
        setError(undefined);
        typing.maybeExecute(words.trim() === offered.words ? null : words.trim());
      }}
      reach={reach}
      maxLabelText={MAX_LABEL_TEXT}
      onCreate={create}
      error={error}
      locale={locale}
    />
  );
}
