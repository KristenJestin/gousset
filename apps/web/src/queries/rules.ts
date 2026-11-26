import type { Conditions } from "@gousset/core/rule-values";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getRule, getRuleProposal, getRuleReach, getRules } from "@/functions/rules";

import { ruleKeys } from "./rule-keys";

/** A rule being written: what its reach is read for. */
export type RuleReachDraft = {
  conditions: Conditions;
  merchantId: string | null;
  categoryId: string | null;
  /** The subject it attaches (#37); left out, none. */
  subjectId?: string | null;
};

/** The queries of the rules page and of a correction's proposal. */
export const ruleQueries = {
  /**
   * The rules in the order they are tried, with the accounts their conditions may name, the
   * merchants they name and the subjects they may attach.
   */
  list: () => queryOptions({ queryKey: ruleKeys.list(), queryFn: () => getRules() }),
  /** One rule with its reach; one the user does not have comes back as `{ ok: false, code }`. */
  detail: (ruleId: string) =>
    queryOptions({
      queryKey: ruleKeys.detail(ruleId),
      queryFn: () => getRule({ data: { ruleId } }),
    }),
  /**
   * What a draft would do to the lines already there, as a change of the saved rule `ruleId` when
   * it edits one; the last draft's answer stays on screen while the next one loads.
   */
  reach: (draft: RuleReachDraft, ruleId: string | null) =>
    queryOptions({
      queryKey: ruleKeys.reach(JSON.stringify({ ...draft, ruleId })),
      queryFn: () => getRuleReach({ data: { ...draft, ruleId } }),
      placeholderData: keepPreviousData,
    }),
  /**
   * The rule a correction proposes, setting the category or the merchant (`sets`): its words, and
   * how many lines already there it would change.
   */
  proposal: (lineId: string, sets: Pick<RuleReachDraft, "merchantId" | "categoryId">) =>
    queryOptions({
      queryKey: ruleKeys.proposal(lineId, sets.categoryId, sets.merchantId),
      queryFn: () => getRuleProposal({ data: { lineId, ...sets } }),
      // A proposal is read once, as the correction is made: the lines may change after.
      gcTime: 0,
    }),
};

/** After a rule is made, changed, moved or deleted: every rules query is read again. */
export async function invalidateRules(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ruleKeys.all });
}
