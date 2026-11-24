import { MAX_LABEL_TEXT } from "../rules/conditions";
import { merchantKey } from "./labels";

// The words a rule born from a line looks for in a label (#25, #30), as `lines` classify, `merchants`
// assign and the web's proposals write them: a rule's `label contains` compares the raw label in any
// case, so the words are always found in the line's own label.

/** A text with each letter's accent removed, one character for one, so that places stay. */
function folded(text: string): string {
  return text
    .replaceAll(/./gsu, (character) => {
      const plain = character.normalize("NFKD").replaceAll(/\p{M}/gu, "");

      return plain.length === character.length ? plain : character;
    })
    .replaceAll(/[‘’ʼ`]/gu, "'");
}

const WORD_CHARACTER = /[A-Z0-9&']/;

/** Where `word` stands in `text` from `from` as a whole word, or -1. */
function wordAt(text: string, word: string, from: number): number {
  for (let at = text.indexOf(word, from); at !== -1; at = text.indexOf(word, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + word.length);

    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) {
      return at;
    }
  }

  return -1;
}

/** Where the words of `key` stand in `text`, in order, from `from`: [start, end), or undefined. */
function spanOf(text: string, key: string, from: number): readonly [number, number] | undefined {
  let start = -1;
  let end = from;

  for (const word of key.split(" ")) {
    const at = wordAt(text, word, end);

    if (at === -1) {
      return undefined;
    }

    start = start === -1 ? at : start;
    end = at + word.length;
  }

  return start === -1 ? undefined : [start, end];
}

/**
 * An intermediary's line: from the intermediary's name through the name after it, up to the next
 * break (`CB PAYPAL *PIXELPLAY 21/10` → `PAYPAL *PIXELPLAY`), upper case; undefined when the label
 * names no one after it.
 */
function throughIntermediary(label: string, counterpartyName: string | null): string | undefined {
  const upper = label.toUpperCase();
  // `toUpperCase` may lengthen a character (ß); only the folded text is searched, the upper sliced.
  const text = folded(upper);

  if (text.length !== upper.length) {
    return undefined;
  }

  // The counterparty names the intermediary, or the label does (as its cleaned label).
  const keys = [merchantKey(label, counterpartyName), merchantKey(label, null)];

  for (const key of keys) {
    const named = key === null ? undefined : spanOf(text, key, 0);

    if (named === undefined) {
      continue;
    }

    const after = merchantKey(upper.slice(named[1]), null);
    const paid = after === null ? undefined : spanOf(text, after, named[1]);

    return paid === undefined ? undefined : upper.slice(named[0], paid[1]);
  }

  return undefined;
}

/**
 * The words a rule born from correcting this line looks for: for a line of a merchant, its cleaned
 * label when the label holds it as it is, else the label itself; for an intermediary's line
 * (`intermediary`), the intermediary's name through the name of who was paid, so that the rule is
 * never "contains PAYPAL", or the label itself when it names no one after the intermediary. Cut to
 * what a condition holds.
 */
export function ruleWords(
  label: string,
  counterpartyName: string | null,
  intermediary: boolean,
): string {
  const through = intermediary ? throughIntermediary(label, counterpartyName) : undefined;
  const key = intermediary ? null : merchantKey(label, counterpartyName);

  const words = through ?? (key !== null && label.toUpperCase().includes(key) ? key : label.trim());

  return words.slice(0, MAX_LABEL_TEXT).trim();
}
