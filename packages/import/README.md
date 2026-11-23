# @gousset/import

The statement readers: a file's bytes in, one account's statement out. No database, no network,
no clock: the import job (#20) stores what they return.

```ts
import { readOfx, readQif } from "@gousset/import";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const statement = yield* readOfx(bytes); // OFX 1.x (SGML), OFX 2.x (XML), QFX
  const fromQif = yield* readQif(bytes, { currency: "EUR" }); // QIF names no currency
});
```

Each reader returns an Effect that succeeds with a `Statement` or fails with a `ReadError`.

## What a reader returns

`Statement` (`src/statement.ts`), as the file states it, nothing guessed. Text values are trimmed;
a tab or line break inside one becomes a space, and the characters no label shows are dropped (NUL
and the other control codes, half surrogate pairs, direction marks):

- `currency`: the ISO 4217 code every amount is in. OFX gives it (`CURDEF`); QIF does not, and the
  caller passes the account's.
- `lines`: in the file's order, each a `StatementLine`:
  - `bookedOn`: `YYYY-MM-DD`, the day the bank booked it (OFX `DTPOSTED`, QIF `D`);
  - `valueOn`: `YYYY-MM-DD` or `null`, the value date (OFX `DTAVAIL`; QIF has none);
  - `amountMinor`: an integer of the currency's minor units (cents for EUR, none for JPY, three
    for KWD), negative for money out. It is read from the file's digits, never through a float;
    an amount too large to be held exactly is refused;
  - `label`: the raw label (OFX `NAME`, or the `PAYEE` aggregate's `NAME`, or `MEMO` when neither is
    given; QIF `P`), `""` when the file gives none;
  - `memo`: OFX `MEMO` (unless it stood in for the label), QIF `M`, or `null`;
  - `bankId`: the bank's own id, or `null`: OFX `FITID`, unique within the account; QIF `N`, a
    cheque number or a reference that nothing makes unique.
- `balance`: `{ amountMinor, on }`, the account's balance at the end of the day `on`, or `null`.
  OFX: the ledger balance (`LEDGERBAL`), never the available one. QIF: see below.

`readQif` adds `dateOrder` (`QifDateOrder`): how the file's dates were read.

## Errors

Every error is a tagged error (`src/errors.ts`); all but `NotAStatement` and `InvalidOption` name
the file's line, counted from 1:

- `NotAStatement`: no `<OFX>` element, or no QIF header before the first record;
- `MalformedFile` (`line`, `problem`): the structure is broken, or the file was cut short;
- `MissingField` (`line`, `field`): a required field is missing from the record starting there;
- `InvalidField` (`line`, `field`, `text`, `expected`): a value cannot be read;
- `UnsupportedContent` (`line`, `problem`): an investment statement, several accounts in one file,
  a line in another currency than the account's, an amount whose direction the file does not say;
- `InvalidOption` (`option`, `text`, `expected`): the caller's option cannot be used (`readQif`'s
  `currency` is no ISO 4217 code), whatever the file holds.

`field` is the format's own name (`TRNAMT`, `DTPOSTED`; QIF's letter, `T`, `D`). `problem` and
`expected` are English, for logs and agents; the interface translates from the tag and the fields.
The file's own text in them is quoted, cut to 40 characters and escaped, so that a crafted file
cannot write a long line, or a line of its own, into a log. `InvalidField.text` is the field as
written, whole.

No file makes a reader die: an OFX file nested more than 64 deep (a statement nests about eight) is
`MalformedFile`, and every step is linear in the file's size.

## Decisions

- **Encoding**: UTF-8 when the bytes are valid UTF-8, Windows-1252 otherwise, whatever the file
  declares: banks' declarations are often wrong (an OFX `CHARSET:1252` over UTF-8 bytes), and
  accented Windows-1252 text is almost never valid UTF-8 by chance. Windows-1252 also reads
  Latin-1, which differs only on control codes no statement holds.
- **Dates are days as the bank wrote them.** An OFX time and time zone are checked, then read past:
  moving `20261005000000[-5:EST]` to UTC would book the line on a day the bank never showed.
- **OFX signs**: amounts are signed from the account holder's side, as OFX defines them. A file
  whose amounts all lack a sign while a line typed `DEBIT` takes money in (more than zero) writes
  them unsigned: each line is then signed by its type (`DEBIT`, `PAYMENT`, `CHECK`, `FEE`, `SRVCHG`, `CASH`, `DIRECTDEBIT`,
  `REPEATPMT` out; `CREDIT`, `DEP`, `DIRECTDEP`, `INT`, `DIV` in), and a type that says neither
  (`POS`, `ATM`, `XFER`, `OTHER`) is refused rather than guessed.
- **OFX amounts** take a point or a comma as the decimal mark (French banks write `-12,34`), and no
  thousands separator.
- **OFX text** may be written in XML's CDATA sections (`<NAME><![CDATA[R&D]]></NAME>`), read as
  they are.
- **QIF amounts** are signed as written (`T`, or `U` when `T` is missing); a split's parts (`S`,
  `$`) are read past, the record's total being the line. Thousands may be grouped (`1,234.56`,
  `1.234,56`, `1 234,56`). A lone mark followed by exactly three digits (`1,234`) is refused: it
  may be a thousand or a fraction, and a wrong amount must not reach the ledger.
- **QIF dates** (`03/10/2026`, `10/ 3'26`, `03.10.26`, `2026-10-03`): the whole file decides
  whether the day or the month comes first. When only one order makes every date a day of the
  calendar, the file decides (`decidedBy: "file"`); when the caller passes `dateOrder`, it does
  (`"option"`); when both orders fit, day first is taken, as French banks write, and `decidedBy`
  is `"default"`: the import screen should ask. Two-digit years: Quicken's `'` marks 2000 and later;
  otherwise `00` to `69` are 2000 to 2069 and `70` to `99` are 1970 to 1999.
- **QIF balance**: QIF gives none, except Quicken's opening balance record, the first of a whole
  account's export (`POpening Balance`, `L[Account]`). That record is no line; the balance is the
  opening balance plus every line, as of the latest line's day.
- **One account per file.** OFX can hold several statements and QIF several accounts; a reader
  refuses the second one, and the user exports one account per file.
- **Read past**, and not returned: the account's identifiers (`BANKID`, `ACCTID`), OFX `DTUSER`,
  `TRNTYPE`, `CHECKNUM`, `SIC`, the available balance, QIF categories (`L`), cleared status (`C`)
  and addresses (`A`). Nothing in the issue asks for them yet; adding one is a field here.

## Tests

`src/*.test.ts`: one test per invented sample file of `@gousset/fixture` (`statementSamples`),
comparing the lines read with the lines the file holds; tests naming the line of each error; and
property tests on amounts, dates, and whole statements written by the fixture's writers and read
back.
