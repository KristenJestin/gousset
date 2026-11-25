// A card label's trailing town (#193; the README beside this file, "A card label's town"): a card
// payment's label often ends with the town where the card was used, so one shop's labels differ by
// their last words. No list of towns can ship; the user's own card labels tell them. Pure: no I/O.

import { compactOf, endTrimmed, isCardPayment, merchantKey } from "./labels";
import type { MerchantKey } from "./labels";

/** The fewest letters and digits a shop's name has once its town is dropped. */
const MIN_SHOP = 4;

/** The fewest letters and digits a town has. */
const MIN_TOWN = 3;

/** The fewest letters and digits of a town cut short at a bank's fixed width. */
const MIN_CUT = 4;

/** Articles: a shop's name never ends with one, a town may start with one (`LE HAVRE`). */
const ARTICLES: ReadonlySet<string> = new Set(
  "L LA LE LES THE DAS DEM DEN DER DIE EL LOS LAS".split(" "),
);

/** Prepositions and conjunctions: neither a shop's name ends with one nor a town starts with one. */
const LINKS: ReadonlySet<string> = new Set(
  "A AU AUX D DE DES DU EN ET SUR & AND AT BY FOR IN OF ON TO AM AN BEI IM UND VOM VON ZUM ZUR".split(
    " ",
  ),
);

/** A card key cut before its last words: the shop's name, and what may be its town. */
type Split = {
  readonly shop: MerchantKey;
  readonly shopCompact: string;
  readonly tailCompact: string;
};

/**
 * The split of `words` before `at` when it can be a shop and its town: the name, its end trimmed
 * (rule 11), has at least `MIN_SHOP` letters or digits and ends on no small word, before the trim
 * either; the tail starts
 * with no preposition and has a letter and at least `MIN_TOWN` letters or digits.
 */
function splitAt(words: ReadonlyArray<string>, at: number, end = words.length): Split | undefined {
  const name = endTrimmed(words.slice(0, at));
  // Read before the trim, which drops `DU`, `DE` or `LA` as a date's word, a country or a state:
  // `CAFE DU PORT` is no shop `CAFE` in the town `PORT`.
  const before = words[at - 1] ?? "";
  const last = name.at(-1) ?? "";
  const tail = words.slice(at, end);
  const shop = name.join(" ");
  const tailCompact = compactOf(tail.join(" "));

  const named =
    compactOf(shop).length >= MIN_SHOP &&
    [before, last].every((word) => !ARTICLES.has(word) && !LINKS.has(word));

  const placed =
    tail.length > 0 &&
    !LINKS.has(tail[0] ?? "") &&
    tailCompact.length >= MIN_TOWN &&
    /[A-Z]/.test(tailCompact);

  return named && placed ? { shop, shopCompact: compactOf(shop), tailCompact } : undefined;
}

/** Every split of a key that can be a shop and its town, the longest town first. */
function splitsOf(key: MerchantKey): ReadonlyArray<Split> {
  const words = key.split(" ");

  return words.slice(1).flatMap((_word, index) => {
    const split = splitAt(words, index + 1);

    return split === undefined ? [] : [split];
  });
}

/**
 * A key that ends with its town twice (`FRESHMART RIVERTON RIVERTON`), as some banks print it: the
 * shop, and the town once.
 */
function doubledOf(key: MerchantKey): Split | undefined {
  const words = key.split(" ");

  for (let size = Math.floor((words.length - 1) / 2); size >= 1; size -= 1) {
    const first = words.slice(words.length - 2 * size, words.length - size).join(" ");
    const second = words.slice(words.length - size).join(" ");

    if (first === second) {
      const split = splitAt(words, words.length - 2 * size, words.length - size);

      if (split !== undefined) {
        return split;
      }
    }
  }

  return undefined;
}

function add(index: Map<string, Set<string>>, form: string, value: string): void {
  const values = index.get(form);

  if (values === undefined) {
    index.set(form, new Set([value]));
  } else {
    values.add(value);
  }
}

/**
 * The towns the keys show: a doubled one, and the last words of two shops each paid in the same two
 * places (`PIZZA NOVA` and `FRESHMART`, each in `RIVERTON` and `LAKESIDE`), by their compact form.
 */
function townsOf(splits: ReadonlyArray<Split>, doubled: ReadonlyArray<Split>): ReadonlySet<string> {
  const tailsOf = new Map<string, Set<string>>();
  const shopsOf = new Map<string, Set<string>>();

  for (const split of [...splits, ...doubled]) {
    add(tailsOf, split.shopCompact, split.tailCompact);
    add(shopsOf, split.tailCompact, split.shopCompact);
  }

  const towns = new Set(doubled.map((split) => split.tailCompact));

  for (const [tail, shops] of shopsOf) {
    // The other places of the shops seen so far: one seen again is a second shop's in both.
    const elsewhere = new Set<string>();

    const shared = [...shops].some((shop) => {
      const places = [...(tailsOf.get(shop) ?? [])].filter((place) => place !== tail);
      const again = places.some((place) => elsewhere.has(place));

      for (const place of places) {
        elsewhere.add(place);
      }

      return again;
    });

    if (shared) {
      towns.add(tail);
    }
  }

  return towns;
}

/**
 * The shops of the user's card payments' keys (#193): each key whose last words are a town, with the
 * key without them; a key with no town is left out. A town is what the user's card labels show one:
 * the last words of two shops each paid in the same two places (`PIZZA NOVA RIVERTON`, `PIZZA NOVA
 * LAKESIDE`, `FRESHMART RIVERTON`, `FRESHMART LAKESIDE`), or words doubled at a label's end
 * (`FRESHMART RIVERTON RIVERTON`). A town known so ends any card key whose name before it is a
 * shop's (`splitAt`), the most words that can be; cut short at a bank's fixed width (`RIVERT`, four
 * letters at least), only after a shop another key shows in a whole town. Deterministic, whatever
 * the order of the keys.
 */
export function shopsOf(cardKeys: Iterable<MerchantKey>): ReadonlyMap<MerchantKey, MerchantKey> {
  const keys = [...new Set(cardKeys)].toSorted();
  const doubled = new Map<MerchantKey, Split>();
  const splits: Array<Split> = [];

  for (const key of keys) {
    const twice = doubledOf(key);

    if (twice === undefined) {
      splits.push(...splitsOf(key));
    } else {
      doubled.set(key, twice);
    }
  }

  const towns = townsOf(splits, [...doubled.values()]);
  const shops = new Map<MerchantKey, MerchantKey>();

  if (towns.size === 0) {
    return shops;
  }

  for (const key of keys) {
    const shop = doubled.get(key) ?? splitsOf(key).find((split) => towns.has(split.tailCompact));

    if (shop !== undefined) {
      shops.set(key, shop.shop);
    }
  }

  // A town cut short, after a shop seen in a whole town.
  const known = new Set([...shops.values()].map(compactOf));
  const whole = [...towns];

  for (const key of keys) {
    if (shops.has(key)) {
      continue;
    }

    const cut = splitsOf(key).find(
      (split) =>
        known.has(split.shopCompact) &&
        split.tailCompact.length >= MIN_CUT &&
        whole.some((town) => town !== split.tailCompact && town.startsWith(split.tailCompact)),
    );

    if (cut !== undefined) {
      shops.set(key, cut.shop);
    }
  }

  return shops;
}

/**
 * The shops of the user's card payments' keys, read from their lines (label and counterparty's name):
 * `shopsOf` the keys of the card payments' labels.
 */
export function shopsOfLines(
  lines: ReadonlyArray<{ readonly label: string; readonly counterpartyName: string | null }>,
): ReadonlyMap<MerchantKey, MerchantKey> {
  return shopsOf(
    lines.flatMap((line) => {
      const key = isCardPayment(line.label) ? merchantKey(line.label, line.counterpartyName) : null;

      return key === null ? [] : [key];
    }),
  );
}
