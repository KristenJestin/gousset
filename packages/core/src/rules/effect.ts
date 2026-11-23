import type { EntryKind } from "../category-store";

// What a rule makes of an entry (#25), apart from the database so that it is tested alone: the
// category and merchant it gives, or nothing when it does not apply (docs/data-model.md, v0.3,
// `rule`).

/** An entry a rule may classify: one whole line's, as it is now. */
export type RuleEntry = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly categoryId: string;
  readonly merchantId: string | null;
  readonly classifiedBy: "default" | "rule" | "user";
  readonly ruleId: string | null;
};

/** What a rule sets: a merchant, a category, either or both. */
export type RuleSets = {
  readonly setMerchantId: string | null;
  readonly setCategoryId: string | null;
};

/** The categories and the merchants' default categories a rule's effect reads. */
export type EffectFacts = {
  readonly categories: ReadonlyMap<
    string,
    { readonly kind: EntryKind; readonly archived: boolean }
  >;
  /** Each merchant's default category, when it has one. */
  readonly defaults: ReadonlyMap<string, string>;
};

/** An entry's category and merchant, as a rule leaves them. */
export type RuleTarget = { readonly categoryId: string; readonly merchantId: string | null };

/**
 * What a rule makes of an entry, or null when it does not apply. A rule's category applies to an
 * entry of its kind (an expense category to money that leaves) and not archived. A rule that sets
 * only a merchant gives the entry that merchant's default category when it is usable so, and keeps
 * its category otherwise. A rule that sets nothing applies to nothing.
 */
export function targetOf(sets: RuleSets, target: RuleEntry, facts: EffectFacts): RuleTarget | null {
  const usable = (categoryId: string) => {
    const found = facts.categories.get(categoryId);

    return found !== undefined && found.kind === target.kind && !found.archived;
  };

  if (sets.setCategoryId !== null) {
    return usable(sets.setCategoryId)
      ? { categoryId: sets.setCategoryId, merchantId: sets.setMerchantId ?? target.merchantId }
      : null;
  }

  if (sets.setMerchantId === null) {
    return null;
  }

  const fallback = facts.defaults.get(sets.setMerchantId);

  return {
    categoryId: fallback !== undefined && usable(fallback) ? fallback : target.categoryId,
    merchantId: sets.setMerchantId,
  };
}

/** Whether the rule `ruleId` would change the entry: its category, merchant, or who classified it. */
export const changes = (target: RuleEntry, ruleId: string, wanted: RuleTarget) =>
  target.categoryId !== wanted.categoryId ||
  target.merchantId !== wanted.merchantId ||
  target.classifiedBy !== "rule" ||
  target.ruleId !== ruleId;

/**
 * The first of `rules`, in their order, that the entry's line meets and that applies to the entry,
 * with what it makes of it; null when none does.
 */
export function firstApplying<Rule extends RuleSets>(
  rules: ReadonlyArray<Rule>,
  meets: (rule: Rule) => boolean,
  target: RuleEntry,
  facts: EffectFacts,
): { readonly rule: Rule; readonly wanted: RuleTarget } | null {
  for (const rule of rules) {
    const wanted = meets(rule) ? targetOf(rule, target, facts) : null;

    if (wanted !== null) {
      return { rule, wanted };
    }
  }

  return null;
}
