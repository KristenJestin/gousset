// Meal-voucher top-ups (#28; docs/vision.md, "Top-ups beyond the cap"): when a benefit card cannot
// pay a whole purchase, its issuer charges the rest to a linked bank card, and the two lines are one
// expense. The rules alone, on lines already read, so that every caller decides alike: which bank
// line names an issuer, when a card line paid all the card could, and which two lines go together.
// Conservative on purpose: a pair is made only when each line has the other as its one candidate.

import { shiftDay } from "../transfers/pairing";

/** The words of a text as a label is compared: upper case, accents removed, letters and digits. */
function wordsOf(text: string): ReadonlyArray<string> {
  return text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word !== "");
}

/** The shortest issuer a label is searched for: shorter, it names anything. */
const MIN_ISSUER = 3;

/**
 * The key an issuer is looked for by: its words run together ("Meal Pass" is MEALPASS), or null when
 * too short to name anything surely.
 */
export function issuerKey(institution: string | null): string | null {
  if (institution === null) {
    return null;
  }

  const key = wordsOf(institution).join("");

  return key.length < MIN_ISSUER ? null : key;
}

/**
 * Whether one of the texts names the issuer as a word, or as consecutive words run together:
 * "CB MEALPASS*TOPUP" and "MEAL PASS 0412" both name MEALPASS; "MEALPASSAGE" does not.
 */
export function namesIssuer(texts: ReadonlyArray<string | null>, key: string): boolean {
  return texts.some((text) => {
    if (text === null) {
      return false;
    }

    const words = wordsOf(text);

    for (let start = 0; start < words.length; start += 1) {
      let run = "";

      for (const word of words.slice(start)) {
        run += word;

        if (run === key) {
          return true;
        }

        if (!key.startsWith(run)) {
          break;
        }
      }
    }

    return false;
  });
}

/** A counted line of a benefit account, as its balance is replayed. */
export type CardLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
};

/**
 * The card's money out that paid all the card could at that moment: lines after which the card's
 * balance is nothing or less, or, with a daily cap, after which the day's money out is the cap
 * exactly. Lines in order (booked on, then id); the opening balance first.
 */
export function drainingLines(
  openingBalanceMinor: number,
  lines: ReadonlyArray<CardLine>,
  capMinor: number | null,
): ReadonlySet<string> {
  const drained = new Set<string>();
  let balance = openingBalanceMinor;
  let day = "";
  let spent = 0;

  for (const line of lines) {
    balance += line.amountMinor;

    if (line.bookedOn !== day) {
      day = line.bookedOn;
      spent = 0;
    }

    if (line.amountMinor >= 0) {
      continue;
    }

    spent -= line.amountMinor;

    if (balance <= 0 || (capMinor !== null && spent === capMinor)) {
      drained.add(line.id);
    }
  }

  return drained;
}

/** A benefit card's line that may have had its rest charged to a bank card. */
export type TopUpCardLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly currency: string;
  readonly issuer: string;
  /** How many days after this line the issuer may book the rest: the account's `top_up_days`. */
  readonly days: number;
};

/** A bank line going out, with the texts its issuer is looked for in. */
export type TopUpBankLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly currency: string;
  readonly texts: ReadonlyArray<string | null>;
};

/** A card line and the bank line that paid the rest: one expense. */
export type TopUpPair = { readonly cardLineId: string; readonly bankLineId: string };

function isCandidate(card: TopUpCardLine, bank: TopUpBankLine): boolean {
  return (
    card.currency === bank.currency &&
    bank.bookedOn >= card.bookedOn &&
    bank.bookedOn <= shiftDay(card.bookedOn, card.days) &&
    namesIssuer(bank.texts, card.issuer)
  );
}

/**
 * The pairs to make: a card line and a bank line booked on its day or up to its issuer's days after,
 * in its currency, naming its issuer, each the other's only candidate. Two candidates either way
 * make nothing: the lines wait in the review, and the user links them. Cards' lines are those that
 * paid all the card could (`drainingLines`); both lists hold only lines no one linked or classified.
 */
export function topUpPairs(
  cards: ReadonlyArray<TopUpCardLine>,
  banks: ReadonlyArray<TopUpBankLine>,
): ReadonlyArray<TopUpPair> {
  const ofCard = new Map<string, Array<string>>();
  const ofBank = new Map<string, Array<string>>();

  for (const card of cards) {
    for (const bank of banks) {
      if (isCandidate(card, bank)) {
        ofCard.set(card.id, [...(ofCard.get(card.id) ?? []), bank.id]);
        ofBank.set(bank.id, [...(ofBank.get(bank.id) ?? []), card.id]);
      }
    }
  }

  return cards.flatMap((card) => {
    const [bankLineId, ...others] = ofCard.get(card.id) ?? [];

    if (bankLineId === undefined || others.length > 0) {
      return [];
    }

    const back = ofBank.get(bankLineId) ?? [];

    return back.length === 1 ? [{ cardLineId: card.id, bankLineId }] : [];
  });
}
