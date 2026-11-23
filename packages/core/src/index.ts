// Gousset's logic, called alike by the web app's server functions, the MCP door and the jobs. The
// browser imports `@gousset/core/values` and `@gousset/core/account-values` only.
export {
  AccountAlreadyClosed,
  AccountKeptByLines,
  AccountNameAmbiguous,
  AccountNameUnknown,
  AccountNotClosed,
  AccountNotFound,
  BalanceAlreadyNoted,
  CurrencyLocked,
  DayRangeRefused,
  ExpiryBeforeCredit,
  LineAlreadyReviewed,
  LineNotFound,
  MonthOutOfRange,
  NotACredit,
  SettlementRefused,
} from "./errors";

export { FixtureLedger, Ledger, MONTHS_FROM_TODAY } from "./ledger";

export {
  BENCHMARK_MONTHS,
  approveLine,
  linesToReview,
  monthOverview,
  monthSummary,
  spending,
  spendingDays,
} from "./month";

export type {
  LineToReview,
  LinesToReview,
  Money,
  MonthOverview,
  MonthSummary,
  Spending,
  SpendingDay,
  SpendingDays,
  SpendingRow,
} from "./month";

export {
  accountNamed,
  closeAccount,
  createAccount,
  editAccount,
  listAccounts,
  noteBalance,
  reopenAccount,
  setCreditExpiry,
  showAccount,
} from "./accounts";

export type {
  AccountCredit,
  AccountCredits,
  AccountDetail,
  AccountGroupList,
  AccountLine,
  AccountList,
  AccountSummary,
  AccountView,
  StatementCheck,
  StatementCheckEntry,
  StatementsUntil,
} from "./accounts";

export { AccountStore } from "./account-store";

export type { AccountRecord, LineExpiry } from "./account-store";

export { creditsLeft, expiringOf } from "./credits";

export type { CountedLine, CreditLeft, CreditOrder, CreditsLeft } from "./credits";

export { DatabaseAccountStore } from "./account-store-database";

export { memoryAccountStore, memoryId } from "./account-store-memory";

export type { MemoryBalance, MemoryImport, MemoryLine, MemoryRows } from "./account-store-memory";

export type { DayBalance } from "./balances";

export { flags, importState, investments, movements } from "./review";

export type {
  Flag,
  Flags,
  ImportState,
  InvestmentAccount,
  Investments,
  Movement,
  Movements,
  PartialImport,
} from "./review";

export { Today, currentMonth, today } from "./today";

export { Month, SpendingGroup, addMonths } from "./values";

export {
  EmptyFile,
  FileTooLarge,
  ImportBusy,
  ImportFailed,
  ImportNotFound,
  ImportUnavailable,
  InvalidProfileFile,
  ProfileNameMissing,
  ProfileNotFound,
  ProfileTooLong,
  ProfileUnreadable,
  TooManyProfiles,
  UnknownFormat,
} from "./imports/errors";

export { ImportProfiles, importProfilesLayer } from "./imports/profiles";

export { IMPORTS_LISTED, ImportJobs, Imports, importsLayer } from "./imports/imports";

export type {
  Answers,
  CsvQuestions,
  ImportAccount,
  ImportPage,
  Started,
  Undone,
  Upload,
} from "./imports/imports";

export { ReadFailed, ReadRequest, StatementReader, inlineStatementReader } from "./imports/read";

export {
  IMPORT_STEPS,
  MAX_FILE_BYTES,
  TEST_READ_SHOWN,
  MAX_PROFILE_FILE,
  MAX_PROFILE_HEADER,
  MAX_PROFILE_NAME,
  MAX_PROFILES,
} from "./imports/summary";

export type {
  CsvPreview,
  CsvReadRefusal,
  CsvTestLine,
  ImportFormat,
  ImportProfileEntry,
  ImportStatus,
  ImportStep,
  ImportSummary,
  ProfileChoice,
  ProfileDraft,
  ProfileFile,
  ProfileFit,
  ProfilesForImport,
} from "./imports/summary";

export { ImportJobInput, markFailed, runImport } from "./imports/run";

export type { ImportProgress, ImportRun } from "./imports/run";

export { DataExport, dataExportLayer } from "./export/export";

export type { ExportContents } from "./export/export";

export { EXPORT_FORMAT, EXPORT_VERSION, MANIFEST } from "./export/archive";

export type { ExportArchive } from "./export/archive";

export { EXPORT_TABLES, IMPORT_FILES_FOLDER } from "./export/tables";

export type { ExportTable } from "./export/tables";
