// The shared made-up data: one generator for Storybook stories, tests, the development database
// and the demonstration (docs/architecture.md, "Data loading and skeletons").
export { FIXTURE_SEED, madeUpAccounts, madeUpMonth, monthParts } from "./ledger/ledger";

export type {
  Account,
  AccountKind,
  Expense,
  ImportedStatement,
  Investment,
  Line,
  LineKind,
  MadeUpMonth,
} from "./ledger/ledger";

export { exampleStatement } from "./statements/example";

export {
  statementFormats,
  writeCamt053,
  writeCsv,
  writeMt940,
  writeOfx,
  writeQif,
  writeStatement,
} from "./statements/formats";

export type { StatementFile, StatementFormat } from "./statements/formats";

export { ibanWithCheckDigits } from "./statements/iban";

export { closingBalanceMinor, formatMinor } from "./statements/statement";

export type { Statement, StatementLine } from "./statements/statement";
