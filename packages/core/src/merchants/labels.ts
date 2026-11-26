// How a bank's raw label becomes a merchant (docs/vision.md, "Merchants and rules"): the label is
// cleaned into a key, the words that name who was paid, and keys are matched to the user's
// merchants. Pure: no I/O. The README beside this file gives each rule, why, and its limits.

import { OPERATION_MERCHANT, OPERATION_PREFIXES } from "./operations";
import type { Operation } from "./operations";

/** A cleaned label: upper-case ASCII words separated by one space. */
export type MerchantKey = string;

/**
 * What is known already: each alias's key, and each merchant's name key, with the merchant's id;
 * `intermediary` when the merchant is a payment intermediary (#30), whose keys match only exactly;
 * `whole` for a merchant's name that is the shop of its own cleaned labels, their town dropped
 * (#193, `./towns`), which compares only whole: `BOULANGERIE` from `BOULANGERIE RIVERTON` never
 * takes `BOULANGERIE DUPONT`.
 */
export type KnownKey = {
  readonly key: MerchantKey;
  readonly merchantId: string;
  readonly intermediary?: boolean;
  readonly whole?: boolean;
};

export type Assignment = {
  readonly alias: MerchantKey;
  readonly merchant: { readonly id: string } | { readonly name: string };
};

// A break: what ends a name (a date, a card or store number, a reference, a separator).
const BREAK = " | ";

/** Payment words a label starts with, in French, English, German, Belgian and Swiss styles. */
const PAYMENT_PHRASES: ReadonlyArray<string> = [
  // French
  "CB",
  "CARTE",
  "CARTE BANCAIRE",
  "CARTE N",
  "CARTE NO",
  "PAIEMENT",
  "PAIEMENT CB",
  "PAIEMENT CARTE",
  "PAIEMENT PAR CARTE",
  "PAIEMENT PAR CARTE BANCAIRE",
  "PAIEMENT AVEC LA CARTE",
  "PAIEMENT AVEC LA CARTE DE DEBIT",
  "ACHAT",
  "ACHAT CB",
  "ACHAT CARTE",
  "ACHAT SERVICE",
  "FACTURE CARTE",
  "PRLV",
  "PRELEVEMENT",
  "PRELEVEMENT EUROPEEN",
  "PRELEVEMENT SEPA",
  "SEPA",
  "VIR",
  "VIREMENT",
  "VIREMENT EN VOTRE FAVEUR",
  "RECU",
  "EMIS",
  "INST",
  "INSTANTANE",
  "EUROPEEN",
  "RETOUR",
  "DOMICILIATION",
  "DOMICILIATION EUROPEENNE",
  // English, UK and US
  "CARD PAYMENT",
  "CARD PAYMENT TO",
  "CARD PURCHASE",
  "DEBIT CARD",
  "DEBIT CARD PURCHASE",
  "PAYMENT TO",
  "PURCHASE",
  "PURCHASE AUTHORIZED ON",
  "RECURRING PAYMENT",
  "BILL PAYMENT",
  "BILL PAYMENT TO",
  "DIRECT DEBIT",
  "DIRECT DEBIT TO",
  "STANDING ORDER",
  "STANDING ORDER TO",
  "FASTER PAYMENT",
  "FASTER PAYMENT TO",
  "FASTER PAYMENTS",
  "TRANSFER",
  "TRANSFER TO",
  "TRANSFER FROM",
  "TRF",
  "TRF TO",
  "TRF FROM",
  "ACH",
  "ACH DEBIT",
  "CHECKCARD",
  "POS",
  "POS PURCHASE",
  "CONTACTLESS",
  "CONTACTLESS PAYMENT",
  // Card schemes
  "VISA",
  "VISA DEBIT",
  "MASTERCARD",
  "MAESTRO",
  "BANCONTACT",
  "GIROCARD",
  // German and Swiss German
  "KARTENZAHLUNG",
  "LASTSCHRIFT",
  "BASISLASTSCHRIFT",
  "FOLGELASTSCHRIFT",
  "UEBERWEISUNG",
  "UBERWEISUNG",
  "ECHTZEITUEBERWEISUNG",
  "GUTSCHRIFT",
  "DAUERAUFTRAG",
  "EC KARTE",
  "EINKAUF",
  "KAUF",
  "KAUF DIENSTLEISTUNG",
  "KARTENNUMMER",
];

/**
 * The words a card payment's label starts with (#193): its trailing town is no part of its
 * merchant. `ANN CARTE`, a card's cancellation, is one too (`./operations`).
 */
const CARD_PHRASES: ReadonlyArray<string> = [
  "CB",
  "CARTE",
  "PAIEMENT CB",
  "PAIEMENT CARTE",
  "PAIEMENT PAR CARTE",
  "PAIEMENT AVEC LA CARTE",
  "ACHAT CB",
  "ACHAT CARTE",
  "FACTURE CARTE",
  "CARD",
  "DEBIT CARD",
  "CHECKCARD",
  "POS",
  "CONTACTLESS",
  "VISA",
  "MASTERCARD",
  "MAESTRO",
  "BANCONTACT",
  "GIROCARD",
  "KARTENZAHLUNG",
  "EC KARTE",
];

/** Phrases as words, the longest first. */
const phrases = (list: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  list.map((phrase) => phrase.split(" ")).toSorted((a, b) => b.length - a.length);

/**
 * What is skipped before a name: the payment words, and the operation prefixes whose rest names the
 * merchant (`./operations`): `ANN CARTE`, a card's cancellation, is skipped as `CARTE` is.
 */
const PREFIXES = phrases([
  ...PAYMENT_PHRASES,
  ...OPERATION_PREFIXES.flatMap(({ prefix, operation }) =>
    OPERATION_MERCHANT[operation] === "rest" ? [prefix] : [],
  ),
]);

/**
 * The payment words alone: what a merchant's name skips (a name is the user's words, not a bank's
 * operation), and what a label skipped before the operation prefixes (#194, `formerMerchantKey`).
 */
const PAYMENT_PREFIXES = phrases(PAYMENT_PHRASES);

/** Small words that stand before a date ("LE 21/10", "ON 21 OCT", "VOM 21.10.2026"). */
const CONNECTORS: ReadonlySet<string> = new Set(["ON", "LE", "DU", "AU", "AM", "VOM"]);

/** Words dropped from the end of a name: countries, US states, legal forms, card words. */
const TRAILING: ReadonlySet<string> = new Set([
  ...CONNECTORS,
  // Countries, two and three letters
  ..."FR FRA GB GBR UK DE DEU US USA BE BEL CH CHE NL NLD LU LUX ES ESP IT ITA IE IRL AT AUT PT PRT CA CAN".split(
    " ",
  ),
  // US states, but those that are common words (IN, OR, ME, OK, HI, OH)
  ..."AL AK AZ AR CO CT DC FL GA ID IL IA KS KY LA MA MD MI MN MS MO MT NE NV NH NJ NM NY NC ND PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
  // Legal forms
  ..."SA SAS SASU SARL EURL SNC SELARL CIE & GMBH AG KG UG OHG LTD LIMITED PLC LLP INC LLC CORP BV NV SRL SPA".split(
    " ",
  ),
  // What stands before a card or a reference number
  ..."CARD CARTE KARTE REF".split(" "),
]);

/** Month names and abbreviations, in French, English and German. */
const MONTHS: ReadonlySet<string> = new Set(
  [
    "JAN JANV JANVIER JANUARY FEB FEV FEVR FEVRIER FEBRUARY MAR MARS MARCH MARZ",
    "APR AVR AVRIL APRIL MAY MAI JUN JUIN JUNE JUNI JUL JUIL JUILLET JULY JULI",
    "AUG AOU AOUT AUGUST SEP SEPT SEPTEMBER SEPTEMBRE OCT OKT OCTOBRE OCTOBER OKTOBER",
    "NOV NOVEMBRE NOVEMBER DEC DEZ DECEMBRE DECEMBER DEZEMBER",
  ]
    .join(" ")
    .split(" "),
);

/** Single words that say a cash withdrawal. */
const CASH_WORDS: ReadonlySet<string> = new Set([
  "ATM",
  "BANCOMAT",
  "GELDAUTOMAT",
  "BARGELD",
  "BARGELDAUSZAHLUNG",
  "BARGELDABHEBUNG",
]);

/** Pairs of words that say a cash withdrawal. */
const CASH_PAIRS: ReadonlySet<string> = new Set([
  "RETRAIT DAB",
  "RETRAIT GAB",
  "RETRAIT ESPECES",
  "RETRAIT DISTRIBUTEUR",
  "CASH WITHDRAWAL",
]);

/** The fields of a structured transfer or direct debit, which follow the named party. */
const FIELD =
  /\/\s*(?:MOTIF|REFERENCE|REF|LIBELLE|LIB|ID|RUM|MDT|ECH|IBAN|BIC|EREF|INF|REMI)\b|\b(?:MOTIF|REFERENCE|REF|LIBELLE|LIB|ECH|ID EMETTEUR|ID CREANCIER|MDT|RUM|IBAN|BIC|EREF|MREF|CRED|SVWZ|KREF|ABWA|ICS)\s*[:/+]/;

/** What introduces the named party of a structured transfer. */
const PARTY = /\/(?:DE|FRM|FROM|BEN|POUR)\s+|\b(?:DE|POUR|FROM|TO|BEN|BENEFICIAIRE)\s*:\s*/;

const WEB_SUFFIX = /\.(?:CO\.UK|COM|NET|ORG|FR|DE|IO|EU|BE|CH|NL|ES|IT|UK|APP|SHOP)\b(?:\/\S*)?/g;

const CURRENCY = "(?:EUR|USD|GBP|CHF|CAD)";
const DECIMAL = String.raw`\d+(?:[.,' ]\d{3})*[.,]\d{2}(?!\d)`;

const AMOUNT = new RegExp(
  String.raw`\b${CURRENCY}\s?${DECIMAL}|(?<!\d)${DECIMAL}\s?${CURRENCY}\b`,
  "g",
);

// DD/MM, DD/MM/YY(YY), DD.MM.YY, YYYY-MM-DD, and any bare decimal with them.
const DATE = /(?<!\d)\d{1,4}(?:[/.,-]\d{1,4}){1,2}(?!\d)/g;
const TIME = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g;

// Card processors that stand before the shop's own name; an intermediary is kept (#30).
const PROCESSOR = /\b(?:SQ|TST|SP)\s?\*\s?/g;

type Token = { readonly text: string; readonly isBreak: boolean };

const BREAK_TOKEN: Token = { text: "|", isBreak: true };

/** Upper-case ASCII as far as it goes: accents removed, apostrophes made one. */
function normalized(text: string): string {
  return text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toUpperCase()
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[‘’ʼ`]/gu, "'")
    .replaceAll("Œ", "OE")
    .replaceAll("Æ", "AE")
    .replaceAll("Ø", "O")
    .replaceAll("Đ", "D")
    .replaceAll("Ł", "L")
    .replaceAll("Þ", "TH");
}

/** Whether a label names its party with a marker (`/DE`, `DE:`, `POUR:`, `/FRM`, `/BEN`…). */
function namesParty(label: string): boolean {
  const text = normalized(label);
  const field = FIELD.exec(text);

  return PARTY.test(field === null ? text : text.slice(0, field.index));
}

/** A structured label keeps the named party, and loses the fields after it. */
function structured(text: string): string {
  const field = FIELD.exec(text);
  const head = field === null ? text : text.slice(0, field.index);
  const party = PARTY.exec(head);

  return party === null ? head : head.slice(party.index + party[0].length);
}

function isBreakWord(text: string): boolean {
  return (
    text === "|" ||
    /^\d{3,}$/.test(text) ||
    (/\d/.test(text) && /[A-Z]/.test(text)) ||
    /^X{4,}$/.test(text)
  );
}

function tokensOf(text: string): Array<Token> {
  const web = normalized(text)
    .replaceAll(/\bHTTPS?:\/\//g, " ")
    .replaceAll(/\bWWW\./g, " ")
    .replaceAll(WEB_SUFFIX, BREAK);

  const cleaned = structured(web)
    .replaceAll(AMOUNT, BREAK)
    .replaceAll(DATE, BREAK)
    .replaceAll(TIME, BREAK)
    .replaceAll(PROCESSOR, " ")
    .replaceAll(/[*#]\s*\d+/g, BREAK)
    .replaceAll("*", BREAK)
    .replaceAll("//", BREAK)
    .replaceAll(/\s[-–—]+\s/g, BREAK)
    .replaceAll("|", BREAK)
    .replaceAll(/[^A-Z0-9&'|]+/g, " ");

  const tokens = cleaned.split(" ").flatMap((raw) => {
    const word = raw.replaceAll(/^'+|'+$/g, "");

    return word === "" ? [] : [{ text: word, isBreak: isBreakWord(word) }];
  });

  // "21 OCT" and "21 OCT 26": a date written with its month's name.
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const day = tokens[index];
    const month = tokens[index + 1];

    if (day === undefined || month === undefined || day.isBreak || month.isBreak) {
      continue;
    }

    if (/^\d{1,2}$/.test(day.text) && MONTHS.has(month.text)) {
      tokens[index] = BREAK_TOKEN;
      tokens[index + 1] = BREAK_TOKEN;

      if (/^\d{2}$/.test(tokens[index + 2]?.text ?? "")) {
        tokens[index + 2] = BREAK_TOKEN;
      }
    }
  }

  return tokens;
}

function isCash(tokens: ReadonlyArray<Token>): boolean {
  return tokens.some((token, index) => {
    const next = tokens[index + 1];

    return (
      !token.isBreak &&
      (CASH_WORDS.has(token.text) ||
        (next !== undefined && !next.isBreak && CASH_PAIRS.has(`${token.text} ${next.text}`)))
    );
  });
}

/** How many tokens a phrase of `prefixes` takes at `start`, 0 when none starts there. */
function prefixLength(
  tokens: ReadonlyArray<Token>,
  start: number,
  prefixes: ReadonlyArray<ReadonlyArray<string>>,
): number {
  const phrase = prefixes.find((words) =>
    words.every((word, offset) => {
      const token = tokens[start + offset];

      return token !== undefined && !token.isBreak && token.text === word;
    }),
  );

  return phrase?.length ?? 0;
}

/**
 * The longest a key may be: a new merchant's name is its key, capitalised, and a merchant's name
 * is at most as long (`MAX_MERCHANT_NAME`); the unique indexes on names and aliases stay far from
 * Postgres's limit on an index entry, whatever a label holds.
 */
export const MAX_KEY_LENGTH = 100;

/**
 * What the label's prefix says the line is (`./operations`): `CB` a card payment, `ANN CARTE` its
 * cancellation, `VIR` a transfer, `ECH PRET` a loan's instalment, `F` a fee…; null for none. The
 * prefix is matched whole at the label's start, followed by a space or the label's end.
 */
export function operationOf(label: string): Operation | null {
  const text = normalized(label).replaceAll(/\s+/g, " ").trim();

  const found = OPERATION_PREFIXES.find(
    ({ prefix }) => text === prefix || text.startsWith(`${prefix} `),
  );

  return found?.operation ?? null;
}

/**
 * The steps of a label's cleaning, in order (the README's rules). Each reads the tokens the one
 * before left: cash gives no key; what stands before the name is skipped; the name runs to the next
 * break; what ends it is trimmed.
 */
function keyOf(text: string, prefixes = PREFIXES): MerchantKey | null {
  const tokens = tokensOf(text);

  if (isCash(tokens)) {
    return null;
  }

  // What stands before the name: payment words, dates, card numbers, a lone day number.
  let start = 0;

  while (start < tokens.length) {
    const token = tokens[start];

    if (token === undefined) {
      break;
    }

    const skipped =
      token.isBreak ||
      /^\d+$/.test(token.text) ||
      (CONNECTORS.has(token.text) && tokens[start + 1]?.isBreak === true)
        ? 1
        : prefixLength(tokens, start, prefixes);

    if (skipped === 0) {
      break;
    }

    start += skipped;
  }

  // The name runs to the next break: what follows a date or a number is the place. It stops at
  // `MAX_KEY_LENGTH` characters too: a free text runs on, and a key becomes a merchant's name.
  const name: Array<string> = [];
  let length = -1;

  for (const token of tokens.slice(start)) {
    if (token.isBreak) {
      break;
    }

    if (length + 1 + token.text.length > MAX_KEY_LENGTH) {
      if (name.length === 0) {
        name.push(token.text.slice(0, MAX_KEY_LENGTH));
      }

      break;
    }

    name.push(token.text);
    length += 1 + token.text.length;
  }

  const trimmed = endTrimmed(name);

  return trimmed.length === 0 ? null : trimmed.join(" ");
}

/**
 * A name's words with what ends a name trimmed (rule 11), one word at a time while more than one is
 * left: a country, a US state, a legal form, a card word.
 */
export function endTrimmed(words: ReadonlyArray<string>): ReadonlyArray<string> {
  let end = words.length;

  while (end > 1 && TRAILING.has(words[end - 1] ?? "")) {
    end -= 1;
  }

  return words.slice(0, end);
}

const CARD_WORDS = phrases(CARD_PHRASES);

/**
 * Whether the label is a card payment's (#193), or its cancellation's: it starts with a card's words
 * (`CB`, `CARTE`, `PAIEMENT PAR CARTE`, `CARD PAYMENT`, `CONTACTLESS`, `POS`, `KARTENZAHLUNG`…),
 * whole, or `ANN CARTE`. Only such a label ends with the town where the card was used.
 */
export function isCardPayment(label: string): boolean {
  const operation = operationOf(label);

  if (operation === "card" || operation === "card_cancellation") {
    return true;
  }

  const words = normalized(label)
    .split(/[^A-Z0-9&']+/)
    .filter((word) => word !== "");

  return CARD_WORDS.some((phrase) => phrase.every((word, index) => words[index] === word));
}

/**
 * The key of a label: for a transfer, only the party a marker names (`VIR SEPA RECU /DE ACME
 * CONSEIL` → `ACME CONSEIL`; `VIR DE EPARGNE` gives none); else its key, whose operation prefix, a
 * payment phrase, was skipped. A key that would start with a prefix naming no one (`CB F SHOPLY`)
 * is none: read again, it would give none.
 */
function labelKey(text: string): MerchantKey | null {
  const operation = operationOf(text);

  if (operation !== null && OPERATION_MERCHANT[operation] === "party" && !namesParty(text)) {
    return null;
  }

  const key = keyOf(text);

  return key === null || operationOf(key) === null ? key : null;
}

/**
 * The key that names a statement line's merchant, or null when nothing names one (a cash
 * withdrawal, a loan's instalment, a fee, a label of only references). counterpartyName
 * (CAMT.053/MT940 give it) is preferred when it gives a key, but for an operation that names no one.
 */
export function merchantKey(label: string, counterpartyName: string | null): MerchantKey | null {
  const operation = operationOf(label);

  if (isCash(tokensOf(label)) || (operation !== null && OPERATION_MERCHANT[operation] === "none")) {
    return null;
  }

  const counterparty = counterpartyName === null ? null : keyOf(counterpartyName);

  return counterparty ?? labelKey(label);
}

/**
 * The key a line's label had before the operation prefixes (#194), which the merchants made before
 * were named from: the boot job's re-read (`./reread`) finds by it the cleaned labels that no line
 * gives any longer.
 */
export function formerMerchantKey(
  label: string,
  counterpartyName: string | null,
): MerchantKey | null {
  if (isCash(tokensOf(label))) {
    return null;
  }

  const counterparty = counterpartyName === null ? null : keyOf(counterpartyName, PAYMENT_PREFIXES);

  return counterparty ?? keyOf(label, PAYMENT_PREFIXES);
}

/**
 * Whether every word of the key is one a name's end drops (a country, a US state, a legal form, a
 * card word): `SARL`, `GMBH`, `FR`. Such words name no one.
 */
export function namesNoOne(key: MerchantKey): boolean {
  return key.split(" ").every((word) => TRAILING.has(word));
}

function capitalised(word: string): string {
  const lower = word.toLowerCase();

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The name a new merchant gets from its key: "GREENMARKET" → "Greenmarket", "CORNER CAFE" →
 * "Corner Cafe", "L'ATELIER BLEU" → "L'Atelier Bleu"; a short word with no vowel stays upper case
 * ("TLX" → "TLX").
 */
export function merchantName(key: MerchantKey): string {
  return key
    .split(" ")
    .map((word) => {
      if (word.length <= 4 && !/[AEIOUY]/.test(word)) {
        return word;
      }

      // An elided article or a one-letter prefix: L'Atelier, D'Or, O'Neil.
      const elided = /^([A-Z])'(.+)$/.exec(word);

      return elided === null
        ? capitalised(word)
        : `${elided[1] ?? ""}'${capitalised(elided[2] ?? "")}`;
    })
    .join(" ");
}

/**
 * The key a merchant's own name compares as (the user may rename it): merchantKey of the name
 * alone, or the name upper-cased and cleaned the same way.
 */
export function nameKey(name: string): MerchantKey {
  // A name is the user's words, not a bank's: no operation prefix is read in it.
  const key = keyOf(name, PAYMENT_PREFIXES);

  if (key !== null) {
    return key;
  }

  return normalized(name)
    .replaceAll(/[^A-Z0-9&']+/g, " ")
    .split(" ")
    .flatMap((raw) => {
      const word = raw.replaceAll(/^'+|'+$/g, "");

      return word === "" ? [] : [word];
    })
    .join(" ");
}

/** A key as keys compare: letters and digits only, so GREEN MARKET is GREENMARKET. */
export function compactOf(key: MerchantKey): string {
  return key.replaceAll(/[^A-Z0-9]/g, "");
}

/** The compact form of the key's first 1, 2… words, the whole key left out. */
function prefixesOf(key: MerchantKey): ReadonlyArray<string> {
  const words = key.split(" ");

  return words.slice(1).map((_word, index) => compactOf(words.slice(0, index + 1).join(" ")));
}

/**
 * The known keys' owners (`id:<merchant id>`, or `new:<name>` for a merchant of this batch), by
 * each key's compact form and by each of its word prefixes: a key is matched by lookups, never by
 * reading every known key, so that a recognition of tens of thousands of keys stays linear. An
 * intermediary's keys are only in `exact`: `LYDIA` never takes `LYDIA MARTIN`, a person, nor joins
 * it. A shop, a card label without its town (#193), is only in `shops`, matched whole: `BOULANGERIE`
 * of `BOULANGERIE RIVERTON` never takes `BOULANGERIE DUPONT`.
 */
type Known = {
  readonly byCompact: Map<string, Set<string>>;
  readonly byPrefix: Map<string, Set<string>>;
  readonly exact: Map<string, Set<string>>;
  readonly shops: Map<string, Set<string>>;
};

function add(index: Map<string, Set<string>>, form: string, owner: string): void {
  const owners = index.get(form);

  if (owners === undefined) {
    index.set(form, new Set([owner]));
  } else {
    owners.add(owner);
  }
}

function learn(known: Known, key: MerchantKey, owner: string, intermediary: boolean): void {
  if (intermediary) {
    add(known.exact, compactOf(key), owner);

    return;
  }

  add(known.byCompact, compactOf(key), owner);

  for (const prefix of prefixesOf(key)) {
    add(known.byPrefix, prefix, owner);
  }
}

/** The owners known by a form, sorted, so that a choice never hangs on input order. */
function ownersOf(index: Map<string, Set<string>>, form: string): ReadonlyArray<string> {
  return [...(index.get(form) ?? [])].toSorted();
}

const MIN_PREFIX = 4;

/**
 * The owner whose key or shop is the shop of a card label (#193), its town dropped, compared whole;
 * the smallest when several are.
 */
function ownerOfShop(shop: MerchantKey, known: Known): string | undefined {
  const compact = compactOf(shop);

  const [same] = [
    ...new Set([...ownersOf(known.byCompact, compact), ...ownersOf(known.shops, compact)]),
  ].toSorted();

  return same;
}

/**
 * The owner a key goes to among the known keys, or undefined for a new merchant; an intermediary's
 * key (`intermediary`) only to the same compact form.
 */
function ownerOf(key: MerchantKey, known: Known, intermediary: boolean): string | undefined {
  const compact = compactOf(key);

  // A shop counts here (#193): a key equal to it, a town or none, is its merchant's.
  const [equal] = [
    ...new Set([
      ...ownersOf(known.byCompact, compact),
      ...ownersOf(known.exact, compact),
      ...ownersOf(known.shops, compact),
    ]),
  ].toSorted();

  if (equal !== undefined || intermediary) {
    return equal;
  }

  // The longest known key that the new key starts with, word by word.
  const prefixes = prefixesOf(key);

  for (let index = prefixes.length - 1; index >= 0; index -= 1) {
    const prefix = prefixes[index] ?? "";

    if (prefix.length < MIN_PREFIX) {
      continue;
    }

    const owners = ownersOf(known.byCompact, prefix);

    if (owners.length > 0) {
      return owners.length === 1 ? owners[0] : undefined;
    }
  }

  // The new key starts the keys of exactly one merchant.
  if (compact.length >= MIN_PREFIX) {
    const owners = ownersOf(known.byPrefix, compact);

    if (owners.length === 1) {
      return owners[0];
    }
  }

  return undefined;
}

function shortestFirst(a: MerchantKey, b: MerchantKey): number {
  const words = a.split(" ").length - b.split(" ").length;

  if (words !== 0) {
    return words;
  }

  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/**
 * Which merchant each new key goes to: an existing one, or a new one by name; new keys given in
 * any order, duplicates ignored. One assignment per distinct key, shortest key first.
 * Deterministic. A key of an intermediary (a known one flagged, a new one `isIntermediary` says is
 * one, and every key of the merchant it makes) matches only the same compact form. A card label's
 * key that `shopOf` gives a shop, its town dropped (#193, `./towns`), goes first to the merchant
 * whose key or shop is that shop, compared whole, and a new merchant is named after the shop.
 */
export function assignMerchants(
  keys: ReadonlyArray<MerchantKey>,
  known: ReadonlyArray<KnownKey>,
  isIntermediary: (key: MerchantKey) => boolean = () => false,
  shopOf: (key: MerchantKey) => MerchantKey | undefined = () => undefined,
): ReadonlyArray<Assignment> {
  const index: Known = {
    byCompact: new Map(),
    byPrefix: new Map(),
    exact: new Map(),
    shops: new Map(),
  };

  // The owners whose keys match only exactly: intermediaries, known or made in this run.
  const exactOwners = new Set<string>();

  /** The shop of a key, but for an intermediary's, which matches only exactly. */
  const shopOfKey = (key: MerchantKey): MerchantKey | undefined => {
    const shop = shopOf(key);

    return shop === undefined || isIntermediary(key) || isIntermediary(shop) ? undefined : shop;
  };

  for (const { key, merchantId, intermediary, whole } of known) {
    const owner = `id:${merchantId}`;
    const shop = intermediary === true ? undefined : shopOfKey(key);

    if (intermediary === true) {
      exactOwners.add(owner);
    }

    if (whole === true && intermediary !== true) {
      add(index.shops, compactOf(key), owner);
    } else {
      learn(index, key, owner, intermediary === true);
    }

    if (shop !== undefined) {
      add(index.shops, compactOf(shop), owner);
    }
  }

  const merchants = new Map<string, Assignment["merchant"]>(
    known.map(({ merchantId }) => [`id:${merchantId}`, { id: merchantId }]),
  );

  const assignments: Array<Assignment> = [];

  for (const key of [...new Set(keys)].toSorted(shortestFirst)) {
    const shop = shopOfKey(key);
    const name = merchantName(shop ?? key);

    const owner =
      (shop === undefined ? undefined : ownerOfShop(shop, index)) ??
      ownerOf(key, index, isIntermediary(key)) ??
      `new:${name}`;

    const merchant = merchants.get(owner) ?? { name };

    if (isIntermediary(key) && !merchants.has(owner)) {
      exactOwners.add(owner);
    }

    // Each key assigned is known for the next, as it will be once its alias is written.
    merchants.set(owner, merchant);
    learn(index, key, owner, exactOwners.has(owner));

    if (shop !== undefined && !exactOwners.has(owner)) {
      add(index.shops, compactOf(shop), owner);
    }

    assignments.push({ alias: key, merchant });
  }

  return assignments;
}
