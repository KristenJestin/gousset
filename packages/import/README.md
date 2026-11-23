# @gousset/import

The statement readers: a file's bytes in, one account's statement out. No database, no network,
no clock: the import job (#20) stores what they return.

```ts
import { readOfx, readQif } from "@gousset/import";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const statement = yield* readOfx(bytes); // OFX 1.x (SGML), OFX 2.x (XML), QFX
  const unsigned = yield* readOfx(bytes, { amountSigns: "by-type" }); // when the user says so
  const fromQif = yield* readQif(bytes, { currency: "EUR" }); // QIF names no currency
});
```

Each reader returns an Effect that succeeds with a `Statement` or fails with a `ReadError`.

## What a reader returns

`Statement` (`src/statement.ts`), as the file states it, nothing guessed. Text values are trimmed;
a tab or line break inside one (NEL, U+2028 and U+2029 included) becomes a space, and the
characters no label shows are dropped (NUL and the other control codes, half surrogate pairs, bidi
controls):

- `currency`: the ISO 4217 code every amount is in. OFX gives it (`CURDEF`); QIF does not, and the
  caller passes the account's. Its minor units are ISO 4217's (EUR 2, JPY 0, KWD 3, CLF 4), not
  Intl's, whose CLDR figures differ for a few currencies.
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

`readOfx` adds `amountSigns` (`OfxAmountSigns`): how the file's amounts were signed. `readQif` adds
`dateOrder` (`QifDateOrder`): how the file's dates were read.

## Errors

Every error is a tagged error (`src/errors.ts`); all but `NotAStatement` and `InvalidOption` name
the file's line, counted from 1:

- `NotAStatement`: no `<OFX>` element, or no QIF header before the first record;
- `MalformedFile` (`line`, `problem`): the structure is broken, or the file was cut short;
- `MissingField` (`line`, `field`): a required field is missing from the record starting there;
- `InvalidField` (`line`, `field`, `text`, `expected`): a value cannot be read;
- `UnsupportedContent` (`line`, `problem`): an investment statement, several accounts in one file,
  a line in another currency than the account's, an amount whose direction its type does not say, a
  QIF balance too large to be held exactly, a file of more than 64 MiB;
- `InvalidOption` (`option`, `text`, `expected`): the caller's option cannot be used (`readQif`'s
  `currency` is no ISO 4217 code), whatever the file holds.

`field` is the format's own name (`TRNAMT`, `DTPOSTED`; QIF's letter, `T`, `D`). `problem` and
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
(past the engine's longest string, decoding would throw), an OFX file nested more than 64 deep (a
statement nests about eight) is `MalformedFile`, and every step is linear in the file's size.

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
  refuses the second one, and the user exports one account per file.
- **Read past**, and not returned: the account's identifiers (`BANKID`, `ACCTID`), OFX `DTUSER`,
  `TRNTYPE`, `CHECKNUM`, `SIC`, the available balance, QIF categories (`L`), cleared status (`C`)
  and addresses (`A`). Nothing in the issue asks for them yet; adding one is a field here.

## Tests

`src/*.test.ts`: one test per invented sample file of `@gousset/fixture` (`statementSamples`),
comparing the lines read with the lines the file holds; tests naming the line of each error; and
property tests on amounts, dates, and whole statements written by the fixture's writers and read
back.
