# @gousset/import

The statement readers: a file's bytes in, one account's statement out. No database, no network,
no clock: the import job (#20) stores what they return.

```ts
import { detectCsvProfile, readCsv, readOfx, readQif } from "@gousset/import";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const statement = yield* readOfx(bytes); // OFX 1.x (SGML), OFX 2.x (XML), QFX
  const unsigned = yield* readOfx(bytes, { amountSigns: "by-type" }); // when the user says so
  const fromQif = yield* readQif(bytes, { currency: "EUR" }); // QIF names no currency
  const { profile, unsure } = yield* detectCsvProfile(bytes); // a CSV file's profile, proposed
  const fromCsv = yield* readCsv(bytes, profile, { currency: "EUR" }); // once the user agrees
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
`dateOrder` (`QifDateOrder`): how the file's dates were read. `readCsv` adds nothing: its profile
said how to read everything.

CSV: `bookedOn`, `valueOn`, the amount, `label`, `memo` and `bankId` come from the columns the
profile names; `bankId` is whatever the bank put there, which nothing makes unique. A CSV file
gives no balance.

## CSV and import profiles

A CSV file is read with an import profile (`CsvProfile`, `src/csv-profile.ts`), the definition
that `import_profile.definition` stores (`docs/data-model.md`, "Import profiles"): the same JSON
is the file a user exports to share a profile, decoded by the `CsvProfile` schema
(`Schema.fromJsonString(CsvProfile)`). Version 1:

- `separator`: `;`, `,`, a tab or `|`. A value holding it, a quote (written `""`) or a line break is
  quoted, as RFC 4180 says; a quote inside a value that does not start with one is a character.
  Rows end in CRLF, LF or a lone CR;
- `encoding`: `utf8` or `windows-1252` (which also reads Latin-1). A byte order mark is dropped;
  bytes that are not UTF-8 in a file said to be are `MalformedFile`, at their line, rather than
  read with replacement characters;
- `skipRows`: the lines read past before the table (an account's name, a period); `headerRow`:
  whether the table's first row names its columns;
- `dateFormat`: `DD`, `MM`, and `YYYY` or `YY`, day, month, year or month, day, year or year, month,
  day, separated by `/`, `.`, `-`, a space or nothing (`DD/MM/YYYY`, `MM/DD/YY`, `YYYY-MM-DD`,
  `YYYYMMDD`). With a separator, a day or a month may take one digit (`3/10/2026`). Two-digit years
  are QIF's: `00` to `69` are 2000 to 2069;
- `decimalMark`: `.` or `,`. Since the profile says which, every other mark may group thousands, by
  three digits (`1,234.56`, `1 234,56` with a space or a no-break space, `1.234,56`, `1'234.56`),
  and `1,234` is no longer ambiguous;
- `columns`, each counted from 1, as the preview and the errors number them: `bookedOn`, `label`
  and `amount`, required; `valueOn`, `memo`, `bankId` and `currency`, or `null`. `amount` is
  `{ kind: "signed", column }`, negative for money out, or
  `{ kind: "debit-credit", debit, credit }`.

The name, the institution and the kind (`statement`, or a broker's `operations` from v0.6) are the
table's columns, not the definition's. `normalizeHeader` and `readCsvHeader` give the header row as
`import_profile.header` keeps it (trimmed, lower case, joined by `;`), for the import to choose the
user's profile whose header a file has.

**Detection** (`detectCsvProfile`, `src/csv-detect.ts`) proposes a profile for a file it has none
for, which the import screen shows over the preview, from the top of the file (200 rows, within
2,000 lines and a mebibyte): UTF-8 when the bytes are, Windows-1252 otherwise; the separator most rows agree on (the widest table on a tie); the lines before the
first row of that table; a header when no value of the first row is a date; the columns whose every
value is a date, an amount (with a decimal mark or a sign somewhere: digits alone may be a
reference) or a currency code (only under a header saying `Devise` or `Currency`: three capital
letters may be a type, `VIR`, `CHQ`). A column whose header says Debit or Credit is an amount
column whenever its values read as amounts, empty in the sample or in whole units: taken for a
text, the unsigned debits beside it would read as money in. A header's words, accents and case left out, say which is which
(`Date de valeur`, `Libellé`, `Débit`, `Crédit`, `Memo`, `Transaction ID`, `Booking date`, in
English, French and German); without them, the first date column is the booking date, two amount
columns of which no row fills both are a debit and a credit, and the longest text is the label.
`unsure` names what the file left open, for the screen to ask: `dateFormat` (every date reads day
first and month first: day first was taken), `decimalMark` (no amount tells: `,` was taken beside
`;` and tabs, `.` beside `,` and `|`), `amount` (several amount columns and no header word, or no
sign, says which; several headers say `Montant`; a header names a debit without a credit, or both
in one, `Débit/Crédit`). A file with no table of a date column, an amount column and a text column for
the label is `NotAStatement`; the user then picks every column.

Not handled yet: a currency symbol inside an amount (`12,34 €`), a trailing minus (`12,34-`), a
column saying the direction (`D`/`C`) beside an unsigned amount, a balance column, a footer of
totals (its date cannot be read: refused at its line), and profiles shipped for named banks.

## Errors

Every error is a tagged error (`src/errors.ts`); all but `NotAStatement` and `InvalidOption` name
the file's line, counted from 1, and a CSV file's errors the `column` too, counted from 1, when one
is at fault (a row that starts on one line and holds a quoted line break names each value's own
line):

- `NotAStatement`: no `<OFX>` element, no QIF header before the first record, or no CSV table in
  which detection finds a date, an amount and a label column;
- `MalformedFile` (`line`, `problem`): the structure is broken, or the file was cut short;
- `MissingField` (`line`, `field`): a required field is missing from the record starting there;
- `InvalidField` (`line`, `field`, `text`, `expected`): a value cannot be read;
- `UnsupportedContent` (`line`, `problem`): an investment statement, several accounts in one file,
  a line in another currency than the account's, an amount whose direction its type does not say, a
  QIF balance too large to be held exactly, a file of more than 64 MiB; in CSV, a line with both a
  debit and a credit, debits signed both ways in one file, a row of more than 1,000 values, a file
  of more than a million;
- `InvalidOption` (`option`, `text`, `expected`): the caller's option cannot be used (`readQif`'s
  or `readCsv`'s `currency` is no ISO 4217 code), whatever the file holds.

`field` is the format's own name (`TRNAMT`, `DTPOSTED`; QIF's letter, `T`, `D`); in CSV, which has
none, the profile's (`bookedOn`, `valueOn`, `amount`, `debit`, `credit`), the header being the file's
content. A CSV `MalformedFile` is a quoted value that never ends, text after a closing quote, bytes
that are not the profile's UTF-8, no header row, or a header with fewer columns than the profile
reads: the file is another bank's, or its separator differs. `problem` and
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
statement nests about eight) is `MalformedFile`, and every step is linear in the file's size. A CSV
file's blank rows are dropped as they are read, and a row of more than 1,000 values or a file of
more than a million is `UnsupportedContent`: 64 MiB of line breaks or separators would otherwise
build tens of millions of objects. Detection decodes the file once and reads its top alone under
each separator: 200 rows, within 2,000 lines and a mebibyte, a row the limit cuts left out.

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
- **CSV debits and credits**: a bank writes its debits `23,90` or `-23,90`; either way the money
  went out, as long as every debit of the file is signed alike. A debit column holding both signs is
  refused, since either sign may then be a refund; a negative credit is refused too. A zero in the
  other column counts as empty (`-80.00` and `0.00`).
- **One account per file.** OFX can hold several statements and QIF several accounts; a reader
  refuses the second one, and the user exports one account per file.
- **Read past**, and not returned: the account's identifiers (`BANKID`, `ACCTID`), OFX `DTUSER`,
  `TRNTYPE`, `CHECKNUM`, `SIC`, the available balance, QIF categories (`L`), cleared status (`C`)
  and addresses (`A`). Nothing in the issue asks for them yet; adding one is a field here.

## Tests

`src/*.test.ts`: one test per invented sample file of `@gousset/fixture` (`statementSamples`, and
`csvSamples` with a profile each), comparing the lines read with the lines the file holds, and for
each CSV sample the profile detection proposes; tests naming the line (and the CSV column) of each
error; and property tests on amounts, dates, CSV quoting, and whole statements written by the
fixture's writers and read back.
