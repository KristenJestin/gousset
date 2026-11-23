/**
 * The server's instructions (docs/mcp.md, rule 15): under 600 words, what Gousset is, its words,
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
- \`accounts\`: the user's accounts by group (available, restricted, savings and investments, owed) with their balances and totals per currency, and one account's last lines and the check of its balance against its bank statement. Use it for "how much do I have?" or "does my balance match my bank's?".
- \`data\`: what an export of all the user's data holds, and where they download it. Use it when the user asks to export or back up their data.
- \`lines\`: searches every line by text, account, period, amount or to review, and shows one with its category, the import it came from and its transfer; classifies a line in a category or as a transfer, or undoes one. Use it for "is this a transfer to my savings?".
- \`merchants\`: lists, searches and shows the merchants with the cleaned labels that name them; renames one, merges two, splits one by moving a cleaned label to another merchant, or sets the category its entries go in by default. Use it for "which shop is this?" or to tidy merchants up.
- \`categories\`: the expense and income categories on two levels, with their benchmarks and six-month averages; creates, renames, moves, merges and archives them. Name a category as listed, "Parent > Child" for a child.
- \`rules\`: the rules that classify lines by themselves; creates, edits, turns off, and applies one to the lines already there. After a correction with \`lines\`, propose the rule its answer writes.

Results are text, with names rather than ids. A long result comes in parts: its last line writes the next call to make. An error says what to do and gives a valid call. A write needs the connection to have been allowed to read and write; a refusal says how to get it.`;
