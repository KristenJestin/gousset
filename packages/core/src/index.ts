// Gousset's logic, called alike by the web app's server functions, the MCP door and the jobs. The
// browser imports `@gousset/core/values` only.
export { LineAlreadyReviewed, LineNotFound, MonthOutOfRange } from "./errors";

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

export { Today, currentMonth, today } from "./today";

export { Month, SpendingGroup, addMonths } from "./values";
