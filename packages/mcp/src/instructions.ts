/**
 * The server's instructions (docs/mcp.md, rule 15): under 400 words, what Gousset is, its words,
 * and which tool answers what. Every tool is named between backticks, and a test checks that
 * each name so written is a tool of the server.
 */
export const INSTRUCTIONS = `Gousset is a self-hosted personal finance app. It answers "where did my money go?" from the bank statements a person imports, reviewed month by month, and follows their investments. Every tool reads or changes the signed-in user's own data only; amounts carry their currency.

Gousset's words, used in every result:
- expense: what happened, at its net cost, made of payments and refunds.
- payment: the part of an expense paid from one account.
- refund: money that comes back and cancels all or part of an expense.
- transfer: money moving between two of the user's own accounts; never an expense.
- income: money coming in from outside.
- set aside: transfers to savings and investments in the month.
- benefit account: money with restricted use (meal vouchers, say), whose credits may expire.
- category: the kind of expense, exactly one per expense.
- merchant: who was paid, cleaned from the bank's label.
- subject: what the money was spent for (a van, a trip), zero or more per expense.
- benchmark: a suggested monthly mark for a category, not a budget.

Which tool answers what:
- \`month\`: a month's summary (received, spent, set aside, left) and where the money went, by category, merchant and subject, against benchmarks; or the month's review (imports, lines to review, movements between accounts, investments, flags); or one row day by day, against the month before. Use it for "how much did I spend last month, and where?", "what is left to check this month?" and "how is my Groceries spending going compared with last month?".
- \`imports\`: imports a bank statement file into an account without duplicates, and lists, follows and undoes imports. Use it when the user gives a statement or asks what was imported.
- \`data\`: what an export of all the user's data holds, and where they download it. Use it when the user asks to export or back up their data.

Results are text, with names rather than ids. A long result comes in parts: its last line writes the next call to make. An error says what to do and gives a valid call. A write needs the connection to have been allowed to read and write; a refusal says how to get it.`;
