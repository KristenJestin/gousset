// Gousset's logic, called alike by the web app's server functions, the MCP door and the jobs. The
// browser imports `@gousset/core/values` only.
export { LineAlreadyReviewed, LineNotFound, MonthOutOfRange } from "./errors";

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
  AccountNotFound,
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
  MAX_PROFILE_FILE,
  MAX_PROFILE_HEADER,
  MAX_PROFILE_NAME,
  MAX_PROFILES,
} from "./imports/summary";

export type {
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
