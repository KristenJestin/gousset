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
  BalanceCategoryRefused,
  CategoryKindMismatch,
  CategoryRequired,
  CategoryNameAmbiguous,
  CategoryNameTaken,
  CategoryNameUnknown,
  CategoryNotFound,
  CategoryRefused,
  CurrencyLocked,
  DayRangeRefused,
  ExpiryBeforeCredit,
  FundRefused,
  LineAlreadyReviewed,
  LineNotClassifiable,
  LineNotFound,
  LineSearchRefused,
  LinkRefused,
  MonthOutOfRange,
  NotACredit,
  NotATransfer,
  NotFunding,
  NotHeld,
  NotLinked,
  ProposalChanged,
  SettlementRefused,
  SplitRefused,
  TransferRefused,
} from "./errors";

export {
  Expenses,
  expensesLayer,
  fundExpense,
  lineExpensesOf,
  linkLine,
  splitLine,
  unfundExpense,
  unlinkLine,
} from "./expenses/expenses";

export type {
  Expense,
  ExpensePart,
  FundedExpense,
  Funding,
  LineExpenses,
  Linked,
  RefundProposal,
  Share,
  TransferFunding,
} from "./expenses/expenses";

export { FUND_CANDIDATES, FUND_DAYS } from "./expenses/funding";

export { MAX_SHARES, PROPOSALS_SHOWN, REFUND_DAYS } from "./expenses/parts";

export type { PartRole } from "./expenses/parts";

export { matchTopUps } from "./expenses/top-ups";

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

export type { AccountRecord, BalanceCategory, LineExpiry } from "./account-store";

export { remakeEveryBalanceLine } from "./balance-lines";

export { creditsLeft, expiringOf } from "./credits";

export type { CountedLine, CreditLeft, CreditOrder, CreditsLeft } from "./credits";

export { DatabaseAccountStore } from "./account-store-database";

export { memoryAccountStore, memoryId } from "./account-store-memory";

export type { MemoryBalance, MemoryImport, MemoryLine, MemoryRows } from "./account-store-memory";

export type { DayBalance } from "./balances";

export {
  AVERAGE_MONTHS,
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
  archiveCategory,
  categoryNamed,
  classifyLine,
  createCategory,
  editCategory,
  listCategories,
  mergeCategory,
  setMerchantDefaultCategory,
  restoreCategory,
} from "./categories";

export type {
  CategoryEdit,
  CategoryInput,
  CategoryListing,
  CategoryMerge,
  CategoryNode,
  CategoryTree,
  LineClassification,
} from "./categories";

export { CategoryStore } from "./category-store";

export type { Benchmark, CategoryRecord, EntryKind, LineCategory } from "./category-store";

export { DatabaseCategoryStore } from "./category-store-database";

export { memoryCategory, memoryCategoryStore } from "./category-store-memory";

export type {
  MemoryCategoryRows,
  MemoryEntry,
  MemoryMerchant,
  MemoryPart,
} from "./category-store-memory";

export {
  DEFAULT_CATEGORIES,
  copyDefaultCategories,
  defaultRows,
  setLanguageOf,
} from "./default-categories";

export type { DefaultCategory, DefaultName, SetLanguage } from "./default-categories";

export { DEFAULT_SEARCH_LINES, MAX_SEARCH_LINES, searchLines, showLine } from "./lines";

export type { LineAccount, LineDetail, LinePage, LineRow, LineSearch } from "./lines";

export { LineStore } from "./line-store";

export { DatabaseLineStore } from "./line-store-database";

export { memoryLineStore } from "./line-store-memory";

export type { MemoryLineDetail, MemoryLineImport, MemoryLineRows } from "./line-store-memory";

export {
  acceptProposal,
  correctLine,
  discardHeldLine,
  keepHeldLine,
  queuedLine,
  reviewQueue,
} from "./review-queue";

export type {
  CorrectedLine,
  Correction,
  QueuedLine,
  ReviewQueuePage,
  ReviewSearch,
} from "./review-queue";

export { proposalKey, proposalOf } from "./review-proposal";

export type { ProposalFacts, RepeatedLine, ReviewProposal } from "./review-proposal";

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

export { startingPoints } from "./starting-points";

export type { StartingPoints } from "./starting-points";

export { Today, currentMonth, today } from "./today";

export { Month, SpendingGroup, addMonths } from "./values";

export {
  EmptyFile,
  FileTooLarge,
  FileUploadExpired,
  FileUploadIncomplete,
  FileUploadNotFound,
  FileUploadPartRefused,
  ImportBusy,
  ImportFailed,
  ImportNotFound,
  ImportUnavailable,
  InvalidProfileFile,
  ProfileNameMissing,
  ProfileNotFound,
  ProfileTooLong,
  ProfileUnreadable,
  TooManyFileUploads,
  TooManyParts,
  TooManyProfiles,
  UnknownFormat,
} from "./imports/errors";

export {
  MAX_PENDING_UPLOADS,
  MAX_UPLOAD_PARTS,
  UPLOAD_MINUTES,
  parseUploadToken,
  partRefusal,
  requestRefusal,
  sweepUploads,
  uploadState,
  uploadToken,
} from "./imports/uploads";

export type {
  CreatedUpload,
  FileUploadRequest,
  FileUploadState,
  FileUploadStatus,
  ReceivedPart,
  UploadProgress,
} from "./imports/uploads";

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
  UploadAddress,
  UploadChoices,
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

export {
  LineMerchantRefused,
  MerchantAliasNotFound,
  MerchantMergeRefused,
  MerchantNameRefused,
  MerchantNameTaken,
  MerchantNameUnknown,
  MerchantNotFound,
} from "./merchants/errors";

export { merchantKey, merchantName } from "./merchants/labels";

export { KNOWN_INTERMEDIARIES, isKnownIntermediary } from "./merchants/intermediaries";

export { ruleWords } from "./merchants/rule-words";

export type { LineMerchant, LineMerchantAssigned, NamedMerchant } from "./merchants/line-merchant";

export {
  DEFAULT_MERCHANTS_LISTED,
  MAX_MERCHANT_NAME,
  MAX_MERCHANTS_LISTED,
  MERCHANT_LINES_SCANNED,
  MERCHANT_LINES_SHOWN,
  Merchants,
  assignLineMerchant,
  lineMerchant,
  listMerchants,
  markIntermediary,
  merchantsLayer,
  recogniseMerchants,
  showMerchant,
} from "./merchants/merchants";

export type {
  AliasMoved,
  MerchantDefaultCategory,
  MerchantDetail,
  MerchantLine,
  MerchantPage,
  MerchantSearch,
  MerchantSummary,
  Merged,
  Recognised,
} from "./merchants/merchants";

export {
  Transfers,
  lineTransferOf,
  pairEveryLine,
  pairLineWithAccount,
  pairLines,
  transfersLayer,
  unpairLine,
} from "./transfers/transfers";

export type { LineTransfer, PairingSummary, TransferSide, Unpaired } from "./transfers/transfers";

export { CARD_DAYS, TRANSFER_DAYS } from "./transfers/pairing";

export { DataExport, dataExportLayer } from "./export/export";

export type { ExportContents } from "./export/export";

export { EXPORT_FORMAT, EXPORT_VERSION, MANIFEST } from "./export/archive";

export type { ExportArchive } from "./export/archive";

export { EXPORT_TABLES, IMPORT_FILES_FOLDER } from "./export/tables";

export {
  RuleConditionsRefused,
  RuleEffectRefused,
  RuleJobUnavailable,
  RuleNotFound,
  TooManyRules,
} from "./rules/errors";

export {
  MAX_RULES,
  RuleJobInput,
  RuleJobs,
  applyRuleToPast,
  createRule,
  deleteRule,
  editRule,
  listRules,
  moveRule,
  previewRule,
  showRule,
  startApplyToPast,
} from "./rules/rules";

export type {
  RuleAccount,
  RuleApplied,
  RuleCategory,
  RuleDetail,
  RuleEdit,
  RuleEffect,
  RuleInput,
  RuleJobOutcome,
  RuleList,
  RuleOrigin,
  RuleReach,
  RuleSummary,
} from "./rules/rules";

export type { ExportTable } from "./export/tables";
