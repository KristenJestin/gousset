import { Effect } from "effect";

import { invalidField, readAmount } from "./amount";
import type { FieldText } from "./amount";
import { ofxDay } from "./dates";
import { MalformedFile, MissingField, NotAStatement, UnsupportedContent } from "./errors";
import type { InvalidField, ReadError } from "./errors";
import type { Balance, Statement, StatementAccount, StatementLine } from "./statement";
import { cleanValue, decodeEntities, decodeText, ibanOf, quote, statementAccount } from "./text";

// OFX 1.x is SGML: an element that holds a value may go without its closing tag (`<TRNAMT>-12.34`
// then the next tag). OFX 2.x is XML, every element closed. QFX is OFX with a few tags of Intuit's
// (`<INTU.BID>`), read past like any other. One reader takes them all.

/** An OFX element: an aggregate holds elements, the others hold a value. */
type OfxElement = {
  name: string;
  /** The file line its opening tag stands on. */
  line: number;
  /** The text it holds; `undefined` for an aggregate, or an element closed with nothing in it. */
  value: string | undefined;
  children: Array<OfxElement>;
};

function countNewlines(text: string): number {
  return text.split("\n").length - 1;
}

/**
 * How deep elements may nest. A statement nests about eight deep, and an SGML file leaves a few
 * empty elements open on top; a deeper file is no statement, and refusing it keeps the reader's
 * work linear and its recursion short.
 */
const MAX_DEPTH = 64;

const CDATA_START = "<![CDATA[";

const CDATA_END = "]]>";

/**
 * The file's elements, under a nameless root. Its lines end in `\n` alone. An element left open
 * with no value (`<MEMO>` then the next tag, in SGML) is empty: what was read inside it belongs to
 * its parent, and goes back there when the parent closes.
 */
const readElements = (text: string) =>
  Effect.gen(function* () {
    const start = text.search(/<OFX\s*>/i);

    if (start === -1) {
      return yield* new NotAStatement({ format: "ofx" });
    }

    const root: OfxElement = { name: "", line: 0, value: undefined, children: [] };
    const open = [root];
    let line = countNewlines(text.slice(0, start)) + 1;
    let position = start;
    // The element that has just taken its value: its closing tag may follow.
    let ended: OfxElement | undefined;

    /** Whether the open element may take a value: an element, open, holding none yet. */
    const canHoldValue = (holder: OfxElement | undefined): holder is OfxElement =>
      holder !== undefined && holder !== root && holder.children.length === 0;

    while (position < text.length) {
      const nextTag = text.indexOf("<", position);
      const textEnd = nextTag === -1 ? text.length : nextTag;
      const between = text.slice(position, textEnd);
      const value = between.trim();

      if (value !== "") {
        const valueLine = line + countNewlines(between.slice(0, between.indexOf(value)));
        const holder = open.at(-1);

        if (!canHoldValue(holder)) {
          return yield* new MalformedFile({ line: valueLine, problem: "Text outside an element." });
        }

        holder.value = cleanValue(decodeEntities(value));
        open.pop();
        ended = holder;
      }

      line += countNewlines(between);
      position = textEnd;

      if (nextTag === -1) {
        break;
      }

      // XML's CDATA section: its text is the value, as written, `<`, `>` and `&` included.
      if (text.startsWith(CDATA_START, position)) {
        const cdataEnd = text.indexOf(CDATA_END, position);
        const holder = open.at(-1);

        if (cdataEnd === -1) {
          return yield* new MalformedFile({
            line,
            problem: "A CDATA section is never closed by `]]>`.",
          });
        }

        if (!canHoldValue(holder)) {
          return yield* new MalformedFile({ line, problem: "Text outside an element." });
        }

        holder.value = cleanValue(text.slice(position + CDATA_START.length, cdataEnd));
        open.pop();
        ended = holder;
        line += countNewlines(text.slice(position, cdataEnd));
        position = cdataEnd + CDATA_END.length;

        continue;
      }

      const comment = text.startsWith("<!--", position);
      const tagEnd = comment ? text.indexOf("-->", position) + 2 : text.indexOf(">", position);

      if (tagEnd < position + 1) {
        return yield* new MalformedFile({ line, problem: "A tag is never closed by `>`." });
      }

      const tag = text.slice(position + 1, tagEnd).trim();
      const name = /^\/?([^\s/>]*)/.exec(tag)?.[1]?.toUpperCase() ?? "";
      const tagLine = line;

      line += countNewlines(text.slice(position, tagEnd));
      position = tagEnd + 1;

      if (comment || tag.startsWith("?") || tag.startsWith("!")) {
        continue;
      }

      if (name === "") {
        return yield* new MalformedFile({ line: tagLine, problem: "A tag without a name." });
      }

      const parent = open.at(-1) ?? root;

      if (!tag.startsWith("/")) {
        const element: OfxElement = { name, line: tagLine, value: undefined, children: [] };

        parent.children.push(element);
        ended = undefined;

        if (tag.endsWith("/")) {
          element.value = "";
        } else {
          open.push(element);
        }

        // The root is open too: its elements are one level less deep than the stack is long.
        if (open.length > MAX_DEPTH + 1) {
          return yield* new MalformedFile({
            line: tagLine,
            problem: `Elements nested more than ${String(MAX_DEPTH)} deep: no statement is.`,
          });
        }

        continue;
      }

      // `<NAME>v</NAME>`: the element that has just taken its value, the commonest closing tag.
      if (ended?.name === name) {
        ended = undefined;

        continue;
      }

      const closed = open.findLastIndex((element) => element.name === name);

      if (closed <= 0) {
        return yield* new MalformedFile({
          line: tagLine,
          problem: `${quote(`</${name}>`)} closes no open element.`,
        });
      }

      while (open.length > closed + 1) {
        const empty = open.pop();
        const holder = open.at(-1);

        if (empty !== undefined && holder !== undefined) {
          // One by one: a spread of a great many children would pass the engine's argument limit.
          for (const moved of empty.children) {
            holder.children.push(moved);
          }

          empty.children = [];
          empty.value = "";
        }
      }

      open.pop();
      ended = undefined;
    }

    const unclosed = open[1];

    if (unclosed !== undefined) {
      return yield* new MalformedFile({
        line,
        problem: `The file ends before ${quote(`</${unclosed.name}>`)}: it may have been cut short.`,
      });
    }

    return root;
  });

function child(parent: OfxElement, name: string): OfxElement | undefined {
  return parent.children.find((element) => element.name === name);
}

/** Every element named one of `names` under `parent`, not looking inside those found. */
function findAll(parent: OfxElement, names: ReadonlyArray<string>): Array<OfxElement> {
  return parent.children.flatMap((element) =>
    names.includes(element.name) ? [element] : findAll(element, names),
  );
}

/** A child's value; `undefined` when the child is absent or holds nothing. */
function field(parent: OfxElement, name: string): FieldText | undefined {
  const element = child(parent, name);

  if (element === undefined || element.value === undefined || element.value === "") {
    return undefined;
  }

  return { field: name, text: element.value, line: element.line };
}

function required(parent: OfxElement, name: string): Effect.Effect<FieldText, MissingField> {
  const found = field(parent, name);

  if (found === undefined) {
    return Effect.fail(new MissingField({ line: parent.line, field: name }));
  }

  return Effect.succeed(found);
}

const DATE_EXAMPLE = "a date such as 20261002 or 20261002120000[+1:CET]";

function readDay(date: FieldText): Effect.Effect<string, InvalidField> {
  const day = ofxDay(date.text);

  if (day === undefined) {
    return Effect.fail(invalidField(date, DATE_EXAMPLE));
  }

  return Effect.succeed(day);
}

function negate(amountMinor: number): number {
  return amountMinor === 0 ? 0 : -amountMinor;
}

/** The types whose OFX definition says money went out, or came in. */
const OUT_TYPES = new Set([
  "DEBIT",
  "PAYMENT",
  "CHECK",
  "FEE",
  "SRVCHG",
  "CASH",
  "DIRECTDEBIT",
  "REPEATPMT",
]);

const IN_TYPES = new Set(["CREDIT", "DEP", "DIRECTDEP", "INT", "DIV"]);

/**
 * How a file signs its amounts. `as-written`: from the account holder's side, as OFX defines them.
 * `by-type`: each line's type says which way the money went (`DEBIT` out, `CREDIT` in...), its
 * written sign aside, as some banks write every amount without one.
 */
export type AmountSigns = "as-written" | "by-type";

export type OfxOptions = {
  /** How the amounts are signed, when the caller knows; otherwise the file decides (`OfxAmountSigns`). */
  amountSigns?: AmountSigns;
};

/**
 * How the file's amounts were signed. `file`: one reading alone fits: an amount is negative, or no
 * line typed to take money out holds a positive one (`as-written`), or a line's type says neither
 * way (`POS`, `ATM`, `XFER`, `OTHER`), which only `as-written` reads. `option`: the caller's.
 * `default`: every amount is positive or zero, a line typed to take money out holds a positive
 * one, and every type says which way: the amounts may lack their sign, or those lines may be
 * refunds. `by-type` was taken, as such a file is likelier unsigned; the import should ask the user.
 */
export type OfxAmountSigns = { signs: AmountSigns; decidedBy: "file" | "option" | "default" };

export type OfxStatement = Statement & { amountSigns: OfxAmountSigns };

type Transaction = { element: OfxElement; type: FieldText | undefined; line: StatementLine };

/** Which way a line's type says the money went; `undefined` when it says neither. */
function direction(transaction: Transaction): "out" | "in" | undefined {
  const type = transaction.type?.text.toUpperCase() ?? "";

  if (OUT_TYPES.has(type)) {
    return "out";
  }

  return IN_TYPES.has(type) ? "in" : undefined;
}

function decideSigns(
  transactions: ReadonlyArray<Transaction>,
  wanted: AmountSigns | undefined,
): OfxAmountSigns {
  if (wanted !== undefined) {
    return { signs: wanted, decidedBy: "option" };
  }

  // A `DEBIT` of zero says nothing either way, and does not count.
  const mayBeUnsigned =
    transactions.every((transaction) => transaction.line.amountMinor >= 0) &&
    transactions.some(
      (transaction) => direction(transaction) === "out" && transaction.line.amountMinor > 0,
    );

  if (!mayBeUnsigned) {
    return { signs: "as-written", decidedBy: "file" };
  }

  return transactions.every((transaction) => direction(transaction) !== undefined)
    ? { signs: "by-type", decidedBy: "default" }
    : { signs: "as-written", decidedBy: "file" };
}

const readTransaction = (element: OfxElement, currency: string) =>
  Effect.gen(function* () {
    const bookedOn = yield* readDay(yield* required(element, "DTPOSTED"));
    const available = field(element, "DTAVAIL");
    const valueOn = available === undefined ? null : yield* readDay(available);
    const amountMinor = yield* readAmount(yield* required(element, "TRNAMT"), currency, "ofx");
    const lineCurrency = child(element, "CURRENCY");
    const symbol = lineCurrency === undefined ? undefined : field(lineCurrency, "CURSYM");

    if (symbol !== undefined && symbol.text.toUpperCase() !== currency) {
      return yield* new UnsupportedContent({
        line: symbol.line,
        problem: `A line in ${quote(symbol.text)}, while the account is in ${currency}.`,
      });
    }

    const payee = child(element, "PAYEE");
    const name = field(element, "NAME") ?? (payee === undefined ? undefined : field(payee, "NAME"));
    const memo = field(element, "MEMO");

    const line: StatementLine = {
      bookedOn,
      valueOn,
      amountMinor,
      label: (name ?? memo)?.text ?? "",
      memo: name === undefined ? null : (memo?.text ?? null),
      bankId: field(element, "FITID")?.text ?? null,
      counterparty: null,
    };

    return { element, type: field(element, "TRNTYPE"), line };
  });

/**
 * A line signed by its type, its written sign aside. A type that does not say which way the money
 * went (`POS`, `ATM`, `XFER`, `OTHER`) is refused rather than guessed.
 */
function signByType(transaction: Transaction): Effect.Effect<StatementLine, UnsupportedContent> {
  const { line } = transaction;
  const amount = Math.abs(line.amountMinor);

  switch (direction(transaction)) {
    case "out": {
      return Effect.succeed({ ...line, amountMinor: negate(amount) });
    }

    case "in": {
      return Effect.succeed({ ...line, amountMinor: amount });
    }

    case undefined: {
      const type = transaction.type?.text.toUpperCase() ?? "";

      return Effect.fail(
        new UnsupportedContent({
          line: transaction.type?.line ?? transaction.element.line,
          problem: `The amounts are signed by their type, and the type ${quote(type)} does not say whether the money went out or came in.`,
        }),
      );
    }
  }
}

/** The account (`BANKACCTFROM` or `CCACCTFROM`): `ACCTID` as written, and as an IBAN when shaped as one. */
function readAccount(statement: OfxElement): StatementAccount | null {
  const from = child(statement, "BANKACCTFROM") ?? child(statement, "CCACCTFROM");
  const number = from === undefined ? null : (field(from, "ACCTID")?.text ?? null);

  return statementAccount(ibanOf(number), number);
}

const readBalance = (statement: OfxElement, currency: string) =>
  Effect.gen(function* () {
    const ledger = child(statement, "LEDGERBAL");

    if (ledger === undefined) {
      return null;
    }

    const balance: Balance = {
      amountMinor: yield* readAmount(yield* required(ledger, "BALAMT"), currency, "ofx"),
      on: yield* readDay(yield* required(ledger, "DTASOF")),
    };

    return balance;
  });

/**
 * Reads an OFX file (1.x SGML or 2.x XML) or a QFX file: one bank account's statement
 * (`STMTRS`) or one card's (`CCSTMTRS`).
 *
 * Amounts are signed from the account holder's side, as OFX defines them, unless the file may have
 * written them without their sign: every amount positive or zero while a line typed to take money
 * out (`DEBIT`, `CHECK`, `FEE`...) holds a positive one. Each line is then signed by its type, and
 * `amountSigns` says how that was decided (`OfxAmountSigns`); `options.amountSigns` decides
 * instead. The balance is the ledger balance (`LEDGERBAL`), as the bank wrote it.
 */
export const readOfx = (
  bytes: Uint8Array,
  options: OfxOptions = {},
): Effect.Effect<OfxStatement, ReadError> =>
  Effect.gen(function* () {
    const text = yield* decodeText(bytes);
    const root = yield* readElements(text.replaceAll(/\r\n?/g, "\n"));
    const [statement, another] = findAll(root, ["STMTRS", "CCSTMTRS"]);

    if (statement === undefined) {
      const investment = findAll(root, ["INVSTMTRS"])[0];

      if (investment !== undefined) {
        return yield* new UnsupportedContent({
          line: investment.line,
          problem: "An investment statement: Gousset reads bank and card statements.",
        });
      }

      return yield* new MissingField({ line: root.children[0]?.line ?? 1, field: "STMTRS" });
    }

    if (another !== undefined) {
      return yield* new UnsupportedContent({
        line: another.line,
        problem: "A second account's statement: export one account per file.",
      });
    }

    const currencyField = yield* required(statement, "CURDEF");
    const currency = currencyField.text.toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      return yield* invalidField(currencyField, "a currency's ISO 4217 code, such as EUR");
    }

    const list = child(statement, "BANKTRANLIST");
    const elements = list === undefined ? [] : findAll(list, ["STMTTRN"]);

    const transactions = yield* Effect.forEach(elements, (element) =>
      readTransaction(element, currency),
    );

    const amountSigns = decideSigns(transactions, options.amountSigns);

    const lines =
      amountSigns.signs === "by-type"
        ? yield* Effect.forEach(transactions, signByType)
        : transactions.map((transaction) => transaction.line);

    const balance = yield* readBalance(statement, currency);

    return {
      account: readAccount(statement),
      currency,
      lines,
      openingBalance: null,
      balance,
      amountSigns,
    };
  });
