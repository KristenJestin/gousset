// How a bank's raw label becomes a merchant (docs/vision.md, "Merchants and rules"): the label is
// cleaned into a key, the words that name who was paid, and keys are matched to the user's
// merchants. Pure: no I/O. The README beside this file gives each rule, why, and its limits.

/** A cleaned label: upper-case ASCII words separated by one space. */
export type MerchantKey = string;

/** What is known already: each alias's key, and each merchant's name key, with the merchant's id. */
export type KnownKey = { readonly key: MerchantKey; readonly merchantId: string };

export type Assignment = {
  readonly alias: MerchantKey;
  readonly merchant: { readonly id: string } | { readonly name: string };
};

// A break: what ends a name (a date, a card or store number, a reference, a separator).
const BREAK = " | ";

/** Payment words a label starts with, in French, English, German, Belgian and Swiss styles. */
const PREFIXES: ReadonlyArray<ReadonlyArray<string>> = [
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
]
  .map((phrase) => phrase.split(" "))
  .toSorted((a, b) => b.length - a.length);

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

/** How many tokens a payment phrase takes at `start`, 0 when none starts there. */
function prefixLength(tokens: ReadonlyArray<Token>, start: number): number {
  const phrase = PREFIXES.find((words) =>
    words.every((word, offset) => {
      const token = tokens[start + offset];

      return token !== undefined && !token.isBreak && token.text === word;
    }),
  );

  return phrase?.length ?? 0;
}

function keyOf(text: string): MerchantKey | null {
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
        : prefixLength(tokens, start);

    if (skipped === 0) {
      break;
    }

    start += skipped;
  }

  // The name runs to the next break: what follows a date or a number is the place.
  const name: Array<string> = [];

  for (const token of tokens.slice(start)) {
    if (token.isBreak) {
      break;
    }

    name.push(token.text);
  }

  while (name.length > 1 && TRAILING.has(name.at(-1) ?? "")) {
    name.pop();
  }

  return name.length === 0 ? null : name.join(" ");
}

/**
 * The key that names a statement line's merchant, or null when nothing names one (a cash
 * withdrawal, a label of only references). counterpartyName (CAMT.053/MT940 give it) is preferred
 * when it gives a key.
 */
export function merchantKey(label: string, counterpartyName: string | null): MerchantKey | null {
  if (isCash(tokensOf(label))) {
    return null;
  }

  const counterparty = counterpartyName === null ? null : keyOf(counterpartyName);

  return counterparty ?? keyOf(label);
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
  const key = merchantKey(name, null);

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
function compactOf(key: MerchantKey): string {
  return key.replaceAll(/[^A-Z0-9]/g, "");
}

/** The compact form of the key's first 1, 2… words, the whole key left out. */
function prefixesOf(key: MerchantKey): ReadonlyArray<string> {
  const words = key.split(" ");

  return words.slice(1).map((_word, index) => compactOf(words.slice(0, index + 1).join(" ")));
}

/** A known key; its owner is `id:<merchant id>` or `new:<name>` for a merchant of this batch. */
type Entry = {
  readonly compact: string;
  readonly prefixes: ReadonlyArray<string>;
  readonly owner: string;
};

function entryOf(key: MerchantKey, owner: string): Entry {
  return { compact: compactOf(key), prefixes: prefixesOf(key), owner };
}

/** The owners of the entries that pass, sorted, so that a choice never hangs on input order. */
function ownersWhere(entries: ReadonlyArray<Entry>, passes: (entry: Entry) => boolean) {
  const owners = new Set<string>();

  for (const entry of entries) {
    if (passes(entry)) {
      owners.add(entry.owner);
    }
  }

  return [...owners].toSorted();
}

const MIN_PREFIX = 4;

/** The owner a key goes to among the entries, or undefined for a new merchant. */
function ownerOf(key: MerchantKey, entries: ReadonlyArray<Entry>): string | undefined {
  const compact = compactOf(key);
  const [equal] = ownersWhere(entries, (entry) => entry.compact === compact);

  if (equal !== undefined) {
    return equal;
  }

  // The longest known key that the new key starts with, word by word.
  const prefixes = prefixesOf(key);

  for (let index = prefixes.length - 1; index >= 0; index -= 1) {
    const prefix = prefixes[index] ?? "";

    if (prefix.length < MIN_PREFIX) {
      continue;
    }

    const owners = ownersWhere(entries, (entry) => entry.compact === prefix);

    if (owners.length > 0) {
      return owners.length === 1 ? owners[0] : undefined;
    }
  }

  // The new key starts the keys of exactly one merchant.
  if (compact.length >= MIN_PREFIX) {
    const owners = ownersWhere(entries, (entry) => entry.prefixes.includes(compact));

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
 * Deterministic.
 */
export function assignMerchants(
  keys: ReadonlyArray<MerchantKey>,
  known: ReadonlyArray<KnownKey>,
): ReadonlyArray<Assignment> {
  const entries = known.map(({ key, merchantId }) => entryOf(key, `id:${merchantId}`));

  const merchants = new Map<string, Assignment["merchant"]>(
    known.map(({ merchantId }) => [`id:${merchantId}`, { id: merchantId }]),
  );

  const assignments: Array<Assignment> = [];

  for (const key of [...new Set(keys)].toSorted(shortestFirst)) {
    const name = merchantName(key);
    const owner = ownerOf(key, entries) ?? `new:${name}`;
    const merchant = merchants.get(owner) ?? { name };

    // Each key assigned is known for the next, as it will be once its alias is written.
    merchants.set(owner, merchant);
    entries.push(entryOf(key, owner));
    assignments.push({ alias: key, merchant });
  }

  return assignments;
}
