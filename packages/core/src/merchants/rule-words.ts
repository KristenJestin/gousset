import { MAX_LABEL_TEXT } from "../rules/conditions";
import { merchantKey, namesNoOne } from "./labels";

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

/** What may stand between the intermediary's name and who was paid: spaces and signs, `*`. */
const GAP = /[^\p{L}\p{N}&']*/uy;

/**
 * How much of a label is read for an intermediary's line: who was paid comes soon after the
 * intermediary, and each word passed over reads the rest again, so a long label costs no more.
 */
const SCANNED = 4 * MAX_LABEL_TEXT;

/** Where the words after `from` begin, past what may stand between two names. */
function nextWord(text: string, from: number): number {
  GAP.lastIndex = from;
  GAP.exec(text);

  return GAP.lastIndex;
}

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
 * names no one after it. Words after the name that only a key's end drops (a legal form, a country:
 * `PRLV SEPA PAYPAL EUROPE SARL`) are the intermediary's own company, not who was paid: they are
 * passed over, and who was paid is looked for after them (`PAYPAL EUROPE SARL *PIXELPLAY`). Who
 * was paid comes right after, past spaces and signs: a date, a number or a reference between them
 * is a break (`PAYPAL 21/10 RIVERTON` names a place, not who was paid).
 */
function throughIntermediary(
  wholeLabel: string,
  counterpartyName: string | null,
): string | undefined {
  // Cut between two words: half a word would be taken for a name.
  const label =
    wholeLabel.length > SCANNED
      ? wholeLabel.slice(0, SCANNED + 1).replace(/\S*$/u, "")
      : wholeLabel;

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

    let from = named[1];

    while (from < text.length) {
      const after = merchantKey(upper.slice(from), null);
      const paid = after === null ? undefined : spanOf(text, after, from);

      if (after === null || paid === undefined || paid[0] !== nextWord(text, from)) {
        return undefined;
      }

      if (!namesNoOne(after)) {
        return upper.slice(named[0], paid[1]);
      }

      from = paid[1];
    }

    return undefined;
  }

  return undefined;
}

/**
 * The words a rule born from correcting this line looks for: for a line of a merchant, its cleaned
 * label when the label holds it as it is, else the label itself; for an intermediary's line
 * (`intermediary`), the intermediary's name through the name of who was paid, so that the rule is
 * never "contains PAYPAL". Null, for an intermediary's line only, when the label names no one after
 * the intermediary (`CB PAYPAL`, `PAYPAL 21/10`): any words would match every line of the
 * intermediary, so no rule is proposed. Cut to what a condition holds.
 */
export function ruleWords(
  label: string,
  counterpartyName: string | null,
  intermediary: boolean,
): string | null {
  if (intermediary) {
    const through = throughIntermediary(label, counterpartyName);

    return through === undefined ? null : through.slice(0, MAX_LABEL_TEXT).trim();
  }

  const key = merchantKey(label, counterpartyName);
  const words = key !== null && label.toUpperCase().includes(key) ? key : label.trim();

  return words.slice(0, MAX_LABEL_TEXT).trim();
}
