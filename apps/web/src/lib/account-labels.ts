import type { AccountChoice, AccountGroup } from "@gousset/core/account-values";
import { m } from "@gousset/i18n/messages";

// The words for an account's choice and group, kept apart from the components so that a page
// composes them without writing text of its own (AGENTS.md, "Pages only compose packages/ui
// components").

const CHOICE_LABELS = {
  current: m.accountChoiceCurrent,
  savings: m.accountChoiceSavings,
  livret_a: m.accountChoiceLivretA,
  card: m.accountChoiceCard,
  securities: m.accountChoiceSecurities,
  pea: m.accountChoicePea,
  life_insurance: m.accountChoiceLifeInsurance,
  loan: m.accountChoiceLoan,
  benefit: m.accountChoiceBenefit,
} satisfies { readonly [Choice in AccountChoice]: () => string };

/** The choice's words, in the page's language ("Current account", "PEA"). */
export function accountChoiceLabel(choice: AccountChoice): string {
  return CHOICE_LABELS[choice]();
}

const GROUP_LABELS = {
  available: m.accountsGroupAvailable,
  invested: m.accountsGroupInvested,
  restricted: m.accountsGroupRestricted,
  owed: m.accountsGroupOwed,
} satisfies { readonly [Group in AccountGroup]: () => string };

/** The group's words, in the page's language ("Available", "Savings and investments"). */
export function accountGroupLabel(group: AccountGroup): string {
  return GROUP_LABELS[group]();
}

/** The choices stored with an envelope (docs/data-model.md, "Kind and envelope are two columns"). */
const ENVELOPE_CHOICES: ReadonlySet<AccountChoice> = new Set(["livret_a", "pea", "life_insurance"]);

/** The envelope's words for a row's chip ("Livret A", "PEA"); `undefined` for a choice with none. */
export function accountEnvelopeLabel(choice: AccountChoice): string | undefined {
  return ENVELOPE_CHOICES.has(choice) ? accountChoiceLabel(choice) : undefined;
}
