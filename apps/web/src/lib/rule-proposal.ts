import { merchantKey } from "@gousset/core";
import { MAX_LABEL_TEXT } from "@gousset/core/rule-values";

// The rule a correction proposes (#25), as the MCP door's `lines` classify proposes it
// (`proposedRule`): its words are the label's cleaned merchant name when the label holds it as it
// is (a rule looks for them in the raw label, in any case), else the label itself. Server only: the
// cleaning is `@gousset/core`'s.

/** The words a rule born from correcting this line looks for in a label. */
export function proposalWords(label: string, counterpartyName: string | null): string {
  const key = merchantKey(label, counterpartyName);
  const words = key !== null && label.toUpperCase().includes(key) ? key : label.trim();

  return words.slice(0, MAX_LABEL_TEXT);
}
