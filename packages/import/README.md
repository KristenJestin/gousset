# @gousset/import

The statement readers: a file's bytes in, one account's statement out. No database, no network,
no clock: the import job (#20) stores what they return.

```ts
import { readCamt053, readMt940, readOfx, readQif } from "@gousset/import";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const statement = yield* readOfx(bytes); // OFX 1.x (SGML), OFX 2.x (XML), QFX
  const unsigned = yield* readOfx(bytes, { amountSigns: "by-type" }); // when the user says so
  const fromQif = yield* readQif(bytes, { currency: "EUR" }); // QIF names no currency
  const fromCamt = yield* readCamt053(bytes); // ISO 20022 camt.053, 001.02 and later
  const fromMt940 = yield* readMt940(bytes); // SWIFT MT940, with or without its blocks
});
```

Each reader returns an Effect that succeeds with a `Statement` or fails with a `ReadError`.

## What a reader returns

`Statement` (`src/statement.ts`), as the file states it, nothing guessed. Text values are trimmed;
a tab or line break inside one (NEL, U+2028 and U+2029 included) becomes a space, and the
characters no label shows are dropped (NUL and the other control codes, half surrogate pairs, bidi
controls):

- `currency`: the ISO 4217 code every amount is in. OFX gives it (`CURDEF`), CAMT.053 too (`Acct/Ccy`,
  or its amounts' `Ccy`), MT940 in its balances; QIF does not, and the caller passes the account's. Its minor units are ISO 4217's (EUR 2, JPY 0, KWD 3, CLF 4), not
  Intl's, whose CLDR figures differ for a few currencies.
- `lines`: in the file's order, each a `StatementLine`:
  - `bookedOn`: `YYYY-MM-DD`, the day the bank booked it (OFX `DTPOSTED`, QIF `D`, CAMT.053
    `BookgDt`, MT940's entry date, or its value date when the line has no entry date);
  - `valueOn`: `YYYY-MM-DD` or `null`, the value date (OFX `DTAVAIL`, CAMT.053 `ValDt`, MT940's
    value date; QIF has none);
  - `amountMinor`: an integer of the currency's minor units (cents for EUR, none for JPY, three
    for KWD), negative for money out. It is read from the file's digits, never through a float;
    an amount too large to be held exactly is refused;
  - `label`: the raw label (OFX `NAME`, or the `PAYEE` aggregate's `NAME`, or `MEMO` when neither is
    given; QIF `P`; CAMT.053 and MT940 below), `""` when the file gives none;
  - `memo`: OFX `MEMO` (unless it stood in for the label), QIF `M`, CAMT.053 and MT940 below, or
    `null`;
  - `bankId`: the bank's own id, or `null`: OFX `FITID` and CAMT.053 `AcctSvcrRef`, unique within
    the account; QIF `N`, a cheque number or a reference, and MT940's references (often `NONREF`),
    which nothing makes unique;
  - `counterparty`: `{ name, iban }`, who paid or was paid, when the file names either, or `null`
    (always for OFX and QIF). The IBAN is upper case without spaces, `null` when what the file gives
    is not shaped as one (a domestic account number).
- `openingBalance`: `{ amountMinor, on }`, the balance before the statement's first line, at the end
  of the day `on`, or `null`: CAMT.053 and MT940 only (below).
- `balance`: `{ amountMinor, on }`, the closing balance, at the end of the day `on`, or `null`. OFX:
  the ledger balance (`LEDGERBAL`), never the available one. CAMT.053: `CLBD`. MT940: `:62F:` (or
  `:62M:`). QIF: see below.

`readOfx` adds `amountSigns` (`OfxAmountSigns`): how the file's amounts were signed. `readQif` adds
`dateOrder` (`QifDateOrder`): how the file's dates were read.

## Errors

Every error is a tagged error (`src/errors.ts`); all but `NotAStatement` and `InvalidOption` name
the file's line, counted from 1:

- `NotAStatement`: no `<OFX>` element, no QIF header before the first record, no CAMT.053
  `BkToCstmrStmt`, no MT940 `:20:` field;
- `MalformedFile` (`line`, `problem`): the structure is broken, or the file was cut short;
- `MissingField` (`line`, `field`): a required field is missing from the record starting there;
- `InvalidField` (`line`, `field`, `text`, `expected`): a value cannot be read;
- `UnsupportedContent` (`line`, `problem`): an investment statement, several accounts in one file,
  a line in another currency than the account's, an amount whose direction its type does not say, a
  QIF balance too large to be held exactly, a file of more than 64 MiB, a camt.052 report or a
  camt.054 notification, an XML document type declaration, more than a million CAMT.053 elements
  or MT940 fields;
- `InvalidOption` (`option`, `text`, `expected`): the caller's option cannot be used (`readQif`'s
  `currency` is no ISO 4217 code), whatever the file holds.

`field` is the format's own name (`TRNAMT`, `DTPOSTED`; QIF's letter, `T`, `D`; CAMT.053's element,
`Amt`, `CdtDbtInd`; MT940's tag, `:61:`, `:60F:`). `problem` and
`expected` are English, for the user and agents; the interface translates from the tag and the
fields. The file's own text in them is quoted, cut to 40 characters, and its control, format and
separator characters escaped (U+2028 and U+202E among them), so that a crafted file cannot write
a long line, a line of its own or text that reads backwards. `InvalidField.text` is the field as written, cut to
40 characters; `InvalidOption.text` the option the same way.

**`problem`, `expected` and `text` carry the file's content**: amounts, labels, currency symbols.
They are shown to the user and given to agents, **never written to a log, a trace or a metric**: a
log records the error by its tag, with `line`, `field`, `format` or `option` at most
(`docs/architecture.md`, "Telemetry").

No file makes a reader die: a file of more than 64 MiB is `UnsupportedContent` before it is decoded
(past the engine's longest string, decoding would throw), an OFX or CAMT.053 file nested more than 64
deep (a statement nests about eight, or twelve) is `MalformedFile`, and every step is linear in the
file's size.

**CAMT.053 is read by a small XML reader of the package's own** (`src/xml.ts`), not a library: a
statement needs elements, attributes, text, the five entities and character references, and CDATA.
It refuses any document type declaration (`<!DOCTYPE`), so that no entity can be defined, let alone
expanded ("billion laughs"), and no external one fetched; it caps nesting at 64, and scans tags and
attributes by hand, never by a regex that could backtrack.

**Memory is bounded too**: a CAMT.053 file of more than a million elements, or an MT940 file of more
than a million fields, is `UnsupportedContent`, counted before anything is built (a year of daily
statements holds some tens of thousands). 64 MiB of `<a/>` would otherwise make more objects than
the engine's heap holds.

## CAMT.053

- **Versions**: 001.02 and later, read alike. Where they differ, both forms are read: the status
  (`<Sts>BOOK</Sts>`, then `<Sts><Cd>BOOK</Cd></Sts>` from 001.07), a party's name (`Dbtr/Nm`, then
  `Dbtr/Pty/Nm` from 001.08), a date (`Dt` or `DtTm`). A namespace prefix (`camt:Ntry`) is dropped.
- **Signs**: amounts are written without a sign; `CdtDbtInd` gives it (`CRDT` in, `DBIT` out). A
  reversal (`RvslInd`) is signed by its own indicator, as ISO 20022 defines it.
- **Only booked entries are lines**: `BOOK`, or no status. Pending (`PDNG`) and information (`INFO`)
  entries are read past: they are not on the account yet.
- **A batch entry is one line**, as booked: it is the line the bank shows, the one the balances are
  made of, and its `AcctSvcrRef` recognises it in a later import. Its parts (several `TxDtls` under
  one `Ntry`) name no single counterparty nor remittance; only the bank's label (`AddtlNtryInf`) is
  kept.
- **Label**: the bank's own text (`AddtlNtryInf`), else the remittance information (every `Ustrd`,
  joined by a space, else the structured references, `Strd/CdtrRefInf/Ref`), else the
  counterparty's name. **Memo**: the remittance information, when the bank's text is the label.
- **Counterparty**: for money out, the creditor (`RltdPties/Cdtr`, `CdtrAcct/Id/IBAN`); for money
  in, the debtor. A reversal keeps the parties of the payment it reverses: a reversed debit names
  its creditor.
- **Bank id**: the entry's `AcctSvcrRef`, the id the import trusts as unique (`docs/data-model.md`).
  `NtryRef` is not taken, being often a sequence number within one statement, nor a transaction's
  own reference (`TxDtls/Refs`).
- **Balances**: `OPBD` is the balance at the start of its day, so the opening balance is the end of
  the day before (`OPBD` dated 1 November is the balance at the end of 31 October); `PRCD`, the
  previous statement's closing balance, is the end of its own day; `CLBD` the closing balance. The
  available, interim and forward balances are read past.
- **Several statements of one account** (one a day, in one file) are read as one: their lines in
  the file's order, the opening balance the earliest, the closing balance the latest. A statement of
  another account (`Acct/Id`) or another currency is refused.

## MT940

- **Structure**: fields of a tag and a value (`:61:`), a value running on over the lines that start
  no field. SWIFT's blocks (`{1:…}{2:…}{4:` to `-}`) and a message's end (`-`) are read past.
- **`:61:`**: value date (`YYMMDD`), entry date (`MMDD`, the booking date), mark, funds code, amount
  (decimal comma), type, the account owner's reference, `//` and the bank's. The entry date's year is
  the one that puts it closest to the value date (`0102` beside 31 December 2026 is 2 January 2027).
  Two-digit years are 2000 to 2069 for `00` to `69`, 1970 to 1999 otherwise.
- **Signs**: `D` and `RC` (a reversed credit) out, `C` and `RD` (a reversed debit) in.
- **`:86:`**, in its three forms:
  - free text: the label, its line breaks read as spaces;
  - the German banks' subfields (`166?00GUTSCHRIFT?20…?32…`): the label the remittance information
    (`?20` to `?29`, `?60` to `?63`, joined without a space: they are one text cut at a fixed
    width, often in the middle of a word), else the booking text (`?00`), else the name; the memo the
    booking text beside the remittance information; the counterparty `?32` and `?33`, with `?31`
    when it is an IBAN;
  - the `/CODE/` form (`/TRTP/…/NAME/…/IBAN/…/REMI/USTD//…`): the label `/REMI/`, else `/TRTP/`,
    else the name; the memo `/TRTP/` beside `/REMI/`; the counterparty `/NAME/` and `/IBAN/`, or
    `/CNTP/`'s IBAN and name.

  A structured value's lines are cut by length, anywhere: they are joined without a space. A line
  without `:86:` takes its supplementary details (`:61:`'s next lines) as its label.

- **Bank id**: the bank's reference (after `//`), else the account owner's unless it is `NONREF`.
- **Balances**: `:62F:` is the closing balance, the end of its day. `:60F:` is, as SWIFT defines it,
  the previous statement's `:62F:`, its date included: the end of that day. Many banks date it on
  the statement's own first day instead, before that day's lines; so when the statement books a
  line on or before its date, it is the balance at the end of the day before (`:60F:` dated 30
  December, with a line booked that day, is the balance at the end of 29 December). A page's
  balances (`:60M:`, `:62M:`), struck in the middle of a day, are checked and read past. Each
  statement needs its opening and its closing balance (`:60F:` or `:60M:`, `:62F:` or `:62M:`): one
  without may have been cut short (`MissingField`). `:64:` and `:65:` (available, forward) are read
  past.
- **Several statements, or pages, of one account** are read as one, as for CAMT.053. A statement of
  another account (`:25:`) or another currency is refused.

## Decisions

- **Encoding**: UTF-8 when the bytes are valid UTF-8, Windows-1252 otherwise, whatever the file
  declares: banks' declarations are often wrong (an OFX `CHARSET:1252` over UTF-8 bytes), and
  accented Windows-1252 text is almost never valid UTF-8 by chance. Windows-1252 also reads
  Latin-1, which differs only on control codes no statement holds. A UTF-8 byte order mark is
  dropped either way: an editor may write one before Windows-1252 text.
- **Dates are days as the bank wrote them.** An OFX time and time zone are checked, then read past:
  moving `20261005000000[-5:EST]` to UTC would book the line on a day the bank never showed.
- **OFX signs**: amounts are signed from the account holder's side, as OFX defines them, and some
  banks write them all without their sign, letting the type say which way the money went
  (`DEBIT`, `PAYMENT`, `CHECK`, `FEE`, `SRVCHG`, `CASH`, `DIRECTDEBIT`, `REPEATPMT` out; `CREDIT`,
  `DEP`, `DIRECTDEP`, `INT`, `DIV` in). `amountSigns` says which reading was taken, and why, as
  `dateOrder` does for QIF dates:
  - an amount is negative, or no line typed to take money out holds a positive one: as written,
    decided by the file;
  - every amount is positive or zero and a line typed to take money out holds a positive one: the
    amounts may lack their sign, or those lines may be refunds in a period with no money out. When
    a line's type says neither way (`POS`, `ATM`, `XFER`, `OTHER`), only the amounts as written can
    be read: decided by the file. Otherwise each line is signed by its type, by default
    (`decidedBy: "default"`, such a file being likelier unsigned): the import screen should ask;
  - the caller's `amountSigns` option decides instead; `by-type` then refuses a type that says
    neither way rather than guess it.
- **OFX amounts** take a point or a comma as the decimal mark (French banks write `-12,34`), and no
  thousands separator.
- **OFX text** may be written in XML's CDATA sections (`<NAME><![CDATA[R&D]]></NAME>`), read as
  they are.
- **QIF amounts** are signed as written (`T`, or `U` when `T` is missing); a split's parts (`S`,
  `$`) are read past, the record's total being the line. Thousands may be grouped (`1,234.56`,
  `1.234,56`, `1 234,56`). A lone mark followed by exactly three digits (`1,234`) is refused: it
  may be a thousand or a fraction, and a wrong amount must not reach the ledger. In a currency of
  three minor units (KWD, BHD) it is the decimal mark, as every amount under a thousand is written
  there (`12.500`): a thousand written `1,250`, without its decimals, would be read as 1.250.
- **QIF dates** (`03/10/2026`, `10/ 3'26`, `03.10.26`, `2026-10-03`): the whole file decides
  whether the day or the month comes first. When only one order makes every date a day of the
  calendar, the file decides (`decidedBy: "file"`); when the caller passes `dateOrder`, it does
  (`"option"`); when both orders fit, day first is taken, as French banks write, and `decidedBy`
  is `"default"`: the import screen should ask. Two-digit years: Quicken's `'` marks 2000 and later;
  otherwise `00` to `69` are 2000 to 2069 and `70` to `99` are 1970 to 1999.
- **QIF balance**: QIF gives none, except Quicken's opening balance record, the first of a whole
  account's export (`POpening Balance`, `L[Account]`). That record is no line; the balance is the
  opening balance plus every line, as of the latest line's day, refused (`UnsupportedContent`) when
  too large to be held exactly.
- **One account per file.** OFX can hold several statements and QIF several accounts; a reader
  refuses the second one, and the user exports one account per file. CAMT.053 and MT940 read several
  statements of the same account as one.
- **Read past**, and not returned: the account's identifiers (`BANKID`, `ACCTID`, CAMT.053's
  `Acct/Id`, MT940's `:25:`), OFX `DTUSER`, `TRNTYPE`, `CHECKNUM`, `SIC`, the available balance, QIF
  categories (`L`), cleared status (`C`) and addresses (`A`), CAMT.053's bank transaction codes and
  amounts in another currency (`AmtDtls`), MT940's transaction types and statement numbers. Nothing
  in the issue asks for them yet; adding one is a field here.

## Tests

`src/*.test.ts`: one test per invented sample file of `@gousset/fixture` (`statementSamples`),
comparing the lines read with the lines the file holds; tests naming the line of each error; and
property tests on amounts, dates, and whole statements written by the fixture's writers and read
back.
