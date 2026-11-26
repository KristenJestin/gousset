# The library of import profiles

Profile files for exports Gousset does not read on its own, to take or leave: Gousset ships no
broker's profile and recognises no broker by itself (#250). A user who has one of these exports
imports the file through the profile import of the import screen ("Import a profile file"), names
it, and chooses it for the file; an agent does the same with the `imports` tool of the MCP door.
Nothing in the app lists this folder yet: shipping the library inside Gousset is #258's.

Each file is **exactly the JSON a user exports from Gousset** ("Export the profile" on the import
screen): a profile's definition (`CsvDefinition`, `src/operations-profile.ts` and
`src/csv-profile.ts`, README "CSV and import profiles" and "Brokers' operations"), written as the
export writes it, two spaces, every column of the version, a final line break. So it can be read as
it is, by the profile import today and by #258 later, and `vp fmt` leaves it alone (`vite.config.ts`).
Its `description` says, first, whether it is **checked** on a real export or **guessed**, and where
its knowledge comes from.

The folders are by what a profile reads: `operations/` a broker's operations (`reads:
"operations"`), `statements/` an account's statement (none yet: #258 puts the statements' profiles
there).

| File                                  | Broker and export                               | Kind       | Checked or guessed | Where the knowledge comes from                             |
| ------------------------------------- | ----------------------------------------------- | ---------- | ------------------ | ---------------------------------------------------------- |
| `operations/fortuneo-operations.json` | Fortuneo, history of operations (PEA, accounts) | operations | guessed            | Fortuneo's public help pages, remembered, never re-checked |
| `operations/degiro-transactions.json` | Degiro, `Transactions.csv` in English           | operations | guessed            | Degiro's public help pages, remembered, never re-checked   |

**Fortuneo**: `;`, Windows-1252, `DD/MM/YYYY`, a decimal comma, a header row; its columns found by
their names (`Date`, `Opération`, `Libellé`, `Code ISIN`, `Qté`, `Prix d'exé`, `Courtage`, `Montant
net`, `Devise`, and other names it may give them); the words of its `Opération` column, fourteen,
each mapped to a kind; no reference, so an operation is keyed by its content.

**Degiro**: `,`, UTF-8, `DD-MM-YYYY`, a decimal point; purchases and sales only, told by the
quantity's sign (no column names the kind); each amount's currency in the unnamed column after it;
a price in another currency than the account's read from the trade's `Value` in the account's,
divided by the quantity. `Order ID` is not unique to a row (an order executed in parts repeats it).
Its `Account.csv` (deposits, dividends, fees) is not read.

## How to add a profile

1. Make it on Gousset's import screen from a real export, mapped by hand (its columns, the words
   of its kind column, its formats), and export it; or write it by hand, then export it from
   Gousset once imported, so that its text is the export's. A broker's export whose columns move
   is better found by names (`{ "names": [...] }`) than by places: write those by hand.
2. Put it in the folder of what it reads, named by the institution and its export
   (`<broker>-<export>.json`). Begin its `description` with `Checked:` (read on a real export, its
   date) or `Guessed:` (from documentation or memory), then where its knowledge comes from. Never
   a real export's content: no amount, account number, name or reference of anyone.
3. Add an invented export it reads to `@gousset/fixture` (`src/statements/brokers.ts` for a
   broker), and the file to the test of the library (`packages/core/src/imports/profile-library.test.ts`):
   it is the JSON an export writes, and it reads the invented export into the operations, kind
   words and dedup keys expected.
4. Add its row to the table above, and a few lines on what it reads and what is guessed.
