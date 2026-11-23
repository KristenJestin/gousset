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
  LineAlreadyReviewed,
  LineNotFound,
  MonthOutOfRange,
  SettlementRefused,
} from "./errors";

export { FixtureLedger, Ledger, MONTHS_FROM_TODAY } from "./ledger";

export { approveLine, linesToReview, monthOverview, monthSummary, spending } from "./month";

export type {
  LineToReview,
  LinesToReview,
  Money,
  MonthOverview,
  MonthSummary,
  Spending,
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
  showAccount,
} from "./accounts";

export type {
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

export type { AccountRecord } from "./account-store";

export { DatabaseAccountStore } from "./account-store-database";

export { memoryAccountStore, memoryId } from "./account-store-memory";

export type { MemoryBalance, MemoryImport, MemoryLine, MemoryRows } from "./account-store-memory";

export type { DayBalance } from "./balances";

export { Today, currentMonth, today } from "./today";

export { Month, SpendingGroup, addMonths } from "./values";
