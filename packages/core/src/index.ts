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
} from "./month";

export type {
  LineToReview,
  LinesToReview,
  Money,
  MonthOverview,
  MonthSummary,
  Spending,
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
