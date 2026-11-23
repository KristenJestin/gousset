import { Effect } from "effect";

import { invalidField, readAmount } from "./amount";
import type { FieldText } from "./amount";
import { earliest, latest } from "./balances";
import { dayBefore, isoDay } from "./dates";
import { MissingField, NotAStatement, UnsupportedContent } from "./errors";
import type { ReadError } from "./errors";
import type {
  Balance,
  Counterparty,
  Statement,
  StatementAccount,
  StatementLine,
} from "./statement";
import { cleanValue, decodeText, ibanOf, nonEmpty, quote, statementAccount } from "./text";
import { readXml } from "./xml";
import type { XmlElement } from "./xml";

// ISO 20022 CAMT.053, the bank to customer statement: a `Document` holding `BkToCstmrStmt`, then
// one `Stmt` per statement, each with its account (`Acct`), its balances (`Bal`) and its entries
// (`Ntry`). Versions 001.02 to 001.13 differ in a few places read here: the entry's status (`Sts`,
// then `Sts/Cd` from 001.07) and the related parties' names (`Dbtr/Nm`, then `Dbtr/Pty/Nm` from
// 001.08).

/** The element at `path` under `parent`, each step its first child of that name. */
function child(
  parent: XmlElement | undefined,
  ...path: ReadonlyArray<string>
): XmlElement | undefined {
  let found = parent;

  for (const name of path) {
    found = found?.children.find((element) => element.name === name);
  }

  return found;
}

function children(parent: XmlElement | undefined, name: string): Array<XmlElement> {
  return parent?.children.filter((element) => element.name === name) ?? [];
}

/** The tidied text at `path`; `undefined` when the element is absent or holds nothing. */
function field(
  parent: XmlElement | undefined,
  ...path: ReadonlyArray<string>
): FieldText | undefined {
  const element = child(parent, ...path);
  const text = element === undefined ? "" : cleanValue(element.text);

  return element === undefined || text === ""
    ? undefined
    : { field: element.name, text, line: element.line };
}

function textAt(parent: XmlElement | undefined, ...path: ReadonlyArray<string>): string | null {
  return field(parent, ...path)?.text ?? null;
}

function required(parent: XmlElement, name: string): Effect.Effect<FieldText, MissingField> {
  const found = field(parent, name);

  if (found === undefined) {
    return Effect.fail(new MissingField({ line: parent.line, field: name }));
  }

  return Effect.succeed(found);
}

function requiredElement(
  parent: XmlElement,
  name: string,
): Effect.Effect<XmlElement, MissingField> {
  const found = child(parent, name);

  if (found === undefined) {
    return Effect.fail(new MissingField({ line: parent.line, field: name }));
  }

  return Effect.succeed(found);
}

const DATE_EXAMPLE = "a date such as 2026-10-02 or 2026-10-02T10:30:00+01:00";

/** A date element (`BookgDt`, `ValDt`, a balance's `Dt`): its `Dt` or `DtTm`, the day as written. */
const readDate = (holder: XmlElement) =>
  Effect.gen(function* () {
    const written = field(holder, "Dt") ?? field(holder, "DtTm");

    if (written === undefined) {
      return yield* new MissingField({ line: holder.line, field: "Dt" });
    }

    const day = isoDay(written.text);

    if (day === undefined) {
      return yield* invalidField(written, DATE_EXAMPLE);
    }

    return day;
  });

/** An amount (`Amt`) and its direction (`CdtDbtInd`): `credit` when the money came in. */
const readSigned = (holder: XmlElement, currency: string) =>
  Effect.gen(function* () {
    const amount = yield* required(holder, "Amt");
    const amountCurrency = child(holder, "Amt")?.attributes.get("Ccy");

    if (amountCurrency !== undefined && amountCurrency.toUpperCase() !== currency) {
      return yield* new UnsupportedContent({
        line: amount.line,
        problem: `An amount in ${quote(amountCurrency)}, while the account is in ${currency}.`,
      });
    }

    const minor = yield* readAmount(amount, currency, "camt053");
    const indicator = yield* required(holder, "CdtDbtInd");

    switch (indicator.text.toUpperCase()) {
      case "CRDT": {
        return { amountMinor: minor, credit: true };
      }

      case "DBIT": {
        return { amountMinor: minor === 0 ? 0 : -minor, credit: false };
      }

      default: {
        return yield* invalidField(indicator, "CRDT (money in) or DBIT (money out)");
      }
    }
  });

/** The account a statement is of: its IBAN (`Acct/Id/IBAN`), or the other identifier it is given. */
function accountOf(statement: XmlElement): StatementAccount | null {
  const id = child(statement, "Acct", "Id");

  return statementAccount(ibanOf(textAt(id, "IBAN")), textAt(id, "Othr", "Id"));
}

function sameAccount(one: StatementAccount | null, other: StatementAccount | null): boolean {
  return one?.iban === other?.iban && one?.number === other?.number;
}

/** The account's currency: `Acct/Ccy`, else the currency of its first balance or entry. */
const readCurrency = (statement: XmlElement) =>
  Effect.gen(function* () {
    const account = child(statement, "Acct") ?? statement;

    const firstAmount = [...children(statement, "Bal"), ...children(statement, "Ntry")]
      .map((holder) => child(holder, "Amt"))
      .find((amount) => amount?.attributes.has("Ccy") === true);

    const fromAmount =
      firstAmount === undefined
        ? undefined
        : { field: "Ccy", text: firstAmount.attributes.get("Ccy") ?? "", line: firstAmount.line };

    const written = field(account, "Ccy") ?? fromAmount;

    if (written === undefined) {
      return yield* new MissingField({ line: account.line, field: "Ccy" });
    }

    const currency = written.text.toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      return yield* invalidField(written, "a currency's ISO 4217 code, such as EUR");
    }

    return currency;
  });

/**
 * A statement's opening and closing balances. `OPBD`, the balance at the start of its day, is the
 * end of the day before; `PRCD`, the previous statement's closing balance, the end of its own day;
 * `CLBD` the closing balance. The others (available, interim, forward) are read past.
 */
const readBalances = (statement: XmlElement, currency: string) =>
  Effect.gen(function* () {
    let opening: Balance | null = null;
    let closing: Balance | null = null;

    for (const balance of children(statement, "Bal")) {
      const code = textAt(balance, "Tp", "CdOrPrtry", "Cd")?.toUpperCase();

      if (code !== "OPBD" && code !== "PRCD" && code !== "CLBD") {
        continue;
      }

      const day = yield* readDate(yield* requiredElement(balance, "Dt"));
      const { amountMinor } = yield* readSigned(balance, currency);

      if (code === "CLBD") {
        closing ??= { amountMinor, on: day };
      } else {
        opening ??= { amountMinor, on: code === "OPBD" ? dayBefore(day) : day };
      }
    }

    return { opening, closing };
  });

/** Whether an entry is booked: `BOOK`, or no status at all. Pending and information entries are not. */
function isBooked(entry: XmlElement): boolean {
  const status = textAt(entry, "Sts", "Cd") ?? textAt(entry, "Sts");

  return status === null || status.toUpperCase() === "BOOK";
}

/** The remittance information: every `Ustrd`, else every structured reference (`Strd`). */
function readRemittance(transaction: XmlElement): string | null {
  const information = child(transaction, "RmtInf");

  const unstructured = children(information, "Ustrd").flatMap((element) => {
    const text = cleanValue(element.text);

    return text === "" ? [] : [text];
  });

  const references = children(information, "Strd").flatMap((structured) => {
    const reference = textAt(structured, "CdtrRefInf", "Ref");

    return reference === null ? [] : [reference];
  });

  return nonEmpty((unstructured.length > 0 ? unstructured : references).join(" "));
}

/** The party on the other side: the creditor (`Cdtr`) or the debtor (`Dbtr`), and their account. */
function readCounterparty(transaction: XmlElement, side: "Cdtr" | "Dbtr"): Counterparty | null {
  const parties = child(transaction, "RltdPties");
  const party = child(parties, side);
  const name = textAt(party, "Nm") ?? textAt(party, "Pty", "Nm");
  const iban = ibanOf(textAt(parties, `${side}Acct`, "Id", "IBAN"));

  return name === null && iban === null ? null : { name, iban };
}

function isTrue(text: string | null): boolean {
  return text === "true" || text === "1";
}

const readEntry = (entry: XmlElement, currency: string) =>
  Effect.gen(function* () {
    const { amountMinor, credit } = yield* readSigned(entry, currency);
    const bookedOn = yield* readDate(yield* requiredElement(entry, "BookgDt"));
    const valueDate = child(entry, "ValDt");
    const valueOn = valueDate === undefined ? null : yield* readDate(valueDate);
    const details = children(entry, "NtryDtls").flatMap((list) => children(list, "TxDtls"));
    // A batch entry (several `TxDtls`) is one line, as booked: its parts name no single party.
    const transaction = details.length === 1 ? details[0] : undefined;
    const reversal = isTrue(textAt(entry, "RvslInd"));
    // Money out is paid to the creditor, money in comes from the debtor; a reversal keeps the
    // parties of the payment it reverses.
    const side = credit === reversal ? "Cdtr" : "Dbtr";
    const counterparty = transaction === undefined ? null : readCounterparty(transaction, side);
    const remittance = transaction === undefined ? null : readRemittance(transaction);
    const additional = textAt(entry, "AddtlNtryInf");

    const line: StatementLine = {
      bookedOn,
      valueOn,
      amountMinor,
      label: additional ?? remittance ?? counterparty?.name ?? "",
      memo: additional === null || remittance === additional ? null : remittance,
      // The entry's own, which the import trusts as unique (docs/data-model.md); `NtryRef`, unique
      // within one statement only, and the transactions' references are not taken.
      bankId: textAt(entry, "AcctSvcrRef"),
      counterparty,
    };

    return line;
  });

/** The messages of the same family that are no statement, and what to say of them. */
const OTHER_MESSAGES = new Map([
  ["BkToCstmrAcctRpt", "A camt.052 account report"],
  ["BkToCstmrDbtCdtNtfctn", "A camt.054 notification"],
]);

/**
 * Reads a CAMT.053 file (ISO 20022, versions 001.02 and later): one account's statements, a day
 * each or the whole period at once, their booked entries in the file's order.
 *
 * Amounts are signed by their credit or debit indicator (`CRDT` in, `DBIT` out). Entries that are
 * not booked (`PDNG`, `INFO`) are read past. A batch entry is one line. The opening balance is the
 * earliest statement's (`OPBD` or `PRCD`), the closing balance the latest's (`CLBD`).
 */
export const readCamt053 = (bytes: Uint8Array): Effect.Effect<Statement, ReadError> =>
  Effect.gen(function* () {
    const text = (yield* decodeText(bytes)).replaceAll(/\r\n?/g, "\n");

    if (!text.trimStart().startsWith("<")) {
      return yield* new NotAStatement({ format: "camt053" });
    }

    const document = yield* readXml(text);
    const report = child(document, "BkToCstmrStmt");

    if (document === undefined || report === undefined) {
      const other = document?.children.find((element) => OTHER_MESSAGES.has(element.name));

      if (other !== undefined) {
        return yield* new UnsupportedContent({
          line: other.line,
          problem: `${OTHER_MESSAGES.get(other.name) ?? ""}: Gousset reads camt.053 statements.`,
        });
      }

      return yield* new NotAStatement({ format: "camt053" });
    }

    const statements = children(report, "Stmt");
    const [first] = statements;

    if (first === undefined) {
      return yield* new MissingField({ line: report.line, field: "Stmt" });
    }

    const account = accountOf(first);
    const currency = yield* readCurrency(first);
    const openings: Array<Balance> = [];
    const closings: Array<Balance> = [];
    const lines: Array<StatementLine> = [];

    for (const statement of statements) {
      if (!sameAccount(accountOf(statement), account)) {
        return yield* new UnsupportedContent({
          line: statement.line,
          problem: "A second account's statement: export one account per file.",
        });
      }

      const statementCurrency = yield* readCurrency(statement);

      if (statementCurrency !== currency) {
        return yield* new UnsupportedContent({
          line: statement.line,
          problem: `A statement in ${statementCurrency}, while the file's first is in ${currency}.`,
        });
      }

      const { opening, closing } = yield* readBalances(statement, currency);

      if (opening !== null) {
        openings.push(opening);
      }

      if (closing !== null) {
        closings.push(closing);
      }

      for (const entry of children(statement, "Ntry")) {
        if (isBooked(entry)) {
          lines.push(yield* readEntry(entry, currency));
        }
      }
    }

    return {
      account,
      currency,
      lines,
      openingBalance: earliest(openings),
      balance: latest(closings),
    };
  });
