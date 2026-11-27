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
  FutureMonthRefused,
  LineNotClassifiable,
  LineNotFound,
  LineSearchRefused,
  LinkRefused,
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

export {
  LINES_TO_REVIEW_SHOWN,
  MonthFacts,
  monthFactsLayer,
  monthFlags,
  monthImportState,
  monthLinesToReview,
  monthMovements,
  monthReview,
  monthSpending,
  monthSubjectSpending,
  monthSummary,
  spendingDays,
} from "./month";

export type {
  BenefitLine,
  CategorySpending,
  CategorySpendingRead,
  DaysBy,
  ImportState,
  LineToReview,
  MerchantSpending,
  MerchantSpendingRead,
  Money,
  MonthAccount,
  MonthFlag,
  MonthFlags,
  MonthLinesToReview,
  MonthMerchant,
  MonthMovements,
  MonthPart,
  MonthPayback,
  MonthReview,
  MonthRows,
  MonthScope,
  MonthSpending,
  MonthSubject,
  MonthSummary,
  MonthTransfer,
  Movement,
  PartialImport,
  SpendingBy,
  SpendingDay,
  SpendingDays,
  StatementReach,
  SubjectSpending,
  SubjectSpendingRead,
} from "./month";

export {
  MAX_ATTACHED,
  MAX_SUBJECTS,
  MAX_SUBJECT_NAME,
  SUBJECT_EXPENSES_SHOWN,
  SUBJECT_PROPOSALS_SHOWN,
  attachSubject,
  createSubject,
  editSubject,
  listSubjects,
  refuseProposals,
  showSubject,
  subjectMerchantsPreview,
  subjectNamed,
} from "./subjects/subjects";

export type {
  SubjectAccountBalance,
  SubjectAttachment,
  SubjectDetail,
  SubjectEdit,
  SubjectExpense,
  SubjectHeadline,
  SubjectInput,
  SubjectList,
  SubjectListed,
  NamedSubject,
  SubjectMerchantsPreview,
  SubjectPeriod,
  SubjectRecord,
  SubjectSaved,
} from "./subjects/subjects";

export {
  costsOf,
  countedIn,
  makesCycle,
  monthsOf,
  pathOf,
  subtreeOf,
  sumsOf,
  treeOrder,
} from "./subjects/counting";

export type { CostPart, SubjectCost, SubjectName, SubjectNode } from "./subjects/counting";

export {
  EntryNotFound,
  PaybackRefused,
  SubjectNameAmbiguous,
  SubjectNameTaken,
  SubjectNameUnknown,
  SubjectNotFound,
  SubjectRefused,
} from "./subjects/errors";

export {
  MAX_PAYBACK_FROM,
  MAX_PAYBACK_LINES,
  PAYBACK_CANDIDATES_SHOWN,
  attachPayback,
  paybacksWaiting,
} from "./subjects/payback";

export type {
  PaybackAttachment,
  PaybackLine,
  PaybackSettings,
  PaybackWaiting,
  SubjectPayback,
} from "./subjects/payback";

export { leftToUserOf, paybackStateOf, shareLeft } from "./subjects/payback-share";

export type { PaidBackSubject, PaybackState } from "./subjects/payback-share";

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

export {
  BENCHMARK_WINDOW,
  averageWindow,
  benchmarksOf,
  lastDayOf,
  monthBenchmarks,
} from "./benchmarks";

export type {
  BenchmarkFacts,
  CategoryInMonth,
  MonthBenchmark,
  MonthBenchmarks,
} from "./benchmarks";

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
  LANGUAGE_COOKIE,
  copyDefaultCategories,
  defaultRows,
  renamesInto,
  setLanguageOf,
  setLanguageOfRequest,
  settleDefaultNames,
} from "./default-categories";

export type {
  DefaultCategory,
  DefaultName,
  DefaultRename,
  HeldCategory,
  SetLanguage,
} from "./default-categories";

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

export { ImportJobInput, importConnectionName, markFailed, runImport } from "./imports/run";

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

export { merchantKey, merchantName, operationOf } from "./merchants/labels";

export type { Operation } from "./merchants/operations";

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
  markSubscription,
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

export { rereadMerchants } from "./merchants/reread";

export type { Reread } from "./merchants/reread";

export {
  Transfers,
  lineTransferOf,
  pairEveryLine,
  pairKeptLines,
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

export type { ExportArchive, ExportStream } from "./export/archive";

export { EXPORT_TABLES, IMPORT_FILES_FOLDER, RECEIPT_FILES_FOLDER } from "./export/tables";

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
  RuleMerchant,
  RuleNames,
  RuleOrigin,
  RuleReach,
  RuleSubject,
  RuleSummary,
} from "./rules/rules";

export type { ExportTable } from "./export/tables";

export {
  MIN_CHARGES,
  TOLERANCE_DAYS,
  calendarDays,
  detectSubscriptions,
  subscriptionsOfMonth,
} from "./subscriptions/detection";

export type {
  Cadence,
  CalendarItem,
  Charge,
  MonthSubscriptions,
  Subscription,
} from "./subscriptions/detection";

export {
  CHARGE_YEARS,
  Subscriptions,
  expiringCreditsOf,
  followsCredits,
  monthSubscriptions,
  subscriptionCalendar,
  subscriptionsLayer,
} from "./subscriptions/subscriptions";

export type {
  ExpiringCredit,
  MonthSubscriptionsRead,
  SubscriptionCalendar,
} from "./subscriptions/subscriptions";

export {
  SWEEP_AFTER_MINUTES as RECEIPT_SWEEP_AFTER_MINUTES,
  attachReceipt,
  deleteReceipt,
  lineReceipts,
  openReceipt,
  readReceipt,
  subjectReceipts,
  subjectReceiptsZip,
  sweepReceipts,
} from "./attachments/attachments";

export type {
  Receipt,
  ReceiptDownload,
  ReceiptUpload,
  ReceiptsZip,
  SubjectReceipt,
} from "./attachments/attachments";

export {
  ReceiptEmpty,
  ReceiptNotFound,
  ReceiptStorageFailed,
  ReceiptTooLarge,
  ReceiptTypeRefused,
} from "./attachments/errors";

export { ReceiptStorage, receiptStorageLayer } from "./attachments/storage";
