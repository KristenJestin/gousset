/**
 * The server's instructions (docs/mcp.md, rule 15): under 600 words, what Gousset is, its words,
 * and which tool answers what. Every tool is named between backticks, and a test checks that
 * each name so written is a tool of the server.
 */
export const INSTRUCTIONS = `Gousset is a self-hosted personal finance app. It answers "where did my money go?" from the bank statements a person imports, reviewed month by month, and follows their investments. Every tool reads or changes only the signed-in user's data; amounts carry their currency.

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
- \`month\`: the monthly review. Its subscriptions: the payments that recur, those that stopped and the prices that rose. Its benchmarks: each expense category's spending in a month against its benchmark, and what drifts above it. Use it for "am I spending more than usual?". The rest of the review is not available yet: it says so, with no figure; read the user's money with \`accounts\` and \`lines\` meanwhile.
- \`imports\`: imports a bank statement file into an account without duplicates, and lists, follows and undoes imports. Use it when the user gives a statement or asks what was imported.
- \`accounts\`: the user's accounts by group (available, restricted, savings and investments, owed) with balances and totals per currency, and one account's last lines and balance check against its statement; creates, edits, closes and reopens accounts, notes the balance of one kept by its balance and sets a benefit credit's expiry. Use it for "how much do I have?", "does my balance match my bank's?" or to set accounts up before importing statements.
- \`data\`: what an export of all the user's data holds, and where to download it. Use it to export or back up their data.
- \`lines\`: searches every line by text, account, period, amount or to review, and shows one with its category, the import it came from and its transfer; classifies a line in a category or as a transfer, or undoes one; links, splits. Use it for "is this a transfer to my savings?".
- \`merchants\`: lists, searches and shows the merchants with the cleaned labels that name them; renames one, merges two, splits one by moving a cleaned label to another merchant, or sets the category its entries go in by default. Use it for "which shop is this?" or to tidy merchants up.
- \`categories\`: the expense and income categories on two levels, with their benchmarks and six-month averages; creates, renames, moves, merges and archives them. Name a category as listed, "Parent > Child" for a child.
- \`rules\`: rules that classify lines by themselves; creates, edits, turns off, applies one to past lines. After a \`lines\` correction, propose the rule it writes.

Results are text, with names rather than ids. A long result comes in parts, its last line the next call to make. An error says what to do and gives a valid call. A write needs a connection allowed to write; a refusal says how to get it.`;
