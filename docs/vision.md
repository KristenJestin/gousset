# Gousset: vision

What Gousset is for, the principles it follows, and what it does in its first version. Nothing here is code: it is what the tickets build. Every example in this file is invented.

## What Gousset is for

Gousset answers **"where did my money go?"** without asking anyone to plan every euro in advance, and follows **investments** from what was put in to what it earned.

- It is opened **about once a month**, at a desk: import the statements, update the investments, read the month. Success is a monthly review that takes a few minutes and ends with a clear picture of the month.
- It is **open source** (AGPL-3.0) and **self-hosted**: anyone takes the code, installs it on their own server and uses it.
- One installation serves **several users**, each with their own accounts.
- **Nobody's bank credentials are handed to anyone.** Data comes in through files.
- It is **generic**: it plans for as many cases as it can, not one person's banks. Every personal case becomes a feature anyone can use.

### Who uses it

People who self-host their own tools and want to understand their personal finances. A typical user has several bank accounts, a recently opened investment account in a tax envelope, a meal-voucher card from their employer and a works council benefit platform.

The monthly ritual:

1. download a statement from each bank;
2. import them;
3. review what the rules could not classify;
4. read the month.

The review happens in a desktop browser; a phone is for looking things up.

### What it learns from

- **Maybe** (and its fork **Sure**, `we-promise/sure`): the reference for design, and for turning a bank's raw labels into real merchants. Net worth tracking matters less.
- **Actual**: its rules and its import. Its envelope budgeting is the approach Gousset does not take.

Sure and Actual are references to study, not a code base to start from.

## Principles

1. **The month is the unit.** Everything starts from the monthly review ([The monthly review](#the-monthly-review)).
2. **Tracking, with optional benchmarks.** No envelopes where every euro is assigned in advance ([Tracking, not envelopes](#tracking-not-envelopes)).
3. **Nothing leaves the server.** No bank credentials, no data sent out, except security identifiers for prices, which can be turned off ([Nothing leaves the server](#nothing-leaves-the-server)).
4. **An expense is not a bank line.** An expense is what happened; it is made of payments and refunds ([An expense is not a bank line](#an-expense-is-not-a-bank-line)).
5. **Every euro is counted once.** An expense counts at its net cost; a transfer between one's own accounts and a purchase of securities are never spending ([Kinds of money movement](#kinds-of-money-movement)).
6. **Learn rather than ask twice.** Every correction becomes a rule.
7. **Generic before personal.** Every personal case becomes a feature anyone can use.

### Tracking, not envelopes

Gousset starts from what is really spent and proposes **benchmarks** ("about €280 a month on groceries on average"). The user can adjust them, and the app flags a category that drifts above its benchmark. A benchmark is a suggested mark, never a budget.

### Nothing leaves the server

Data enters through files, never through bank credentials. The one exception is fetching security prices: it sends only ISINs, to a source of the user's choice, and it can be turned off. Optional bank sync may come later, as a connector for those who want it ([Later](#later)).

### The monthly review

The monthly review is the central screen and the home page: import, merchants and categories proposed, approval of what is left, then the month at a glance. Net worth is a secondary screen, never the home page.

### Licence

GNU AGPL-3.0-only: whoever runs Gousset as an online service must publish their changes.

## Kinds of money movement

Every movement has a kind:

| Kind | What it is |
|---|---|
| **Expense** | money leaves for good |
| **Income** | money comes in from outside |
| **Transfer** | money moves from one of your accounts to another of your accounts |
| **Purchase or sale of securities** | in an investment account, cash becomes a position, or the reverse |
| **Refund** | money comes back and cancels all or part of an expense |

Neither transfers nor purchases of securities are expenses. The month reads as four blocks: **income**, **spent**, **set aside** (transfers to savings and investments), **left**.

A transfer whose other side is not tracked (a friend's account) stays an expense or an income.

### Following money by flows

Money is followed by flows, not euro by euro.

- The two sides of a transfer are linked: one click goes from one to the other.
- The month's path reads at a glance: salary → current account → investment account → ETF. Its shape is still to be found; a metro-map drawing was ruled out.
- Each investment account knows its **net contributions** (what came out of your pocket) and its gain.
- Following one particular euro makes no sense: money is interchangeable, and saying which of an account's euros paid for the ETF would be arbitrary.

## An expense is not a bank line

The **expense** is what happened: a €36 dinner at a given restaurant, category Restaurants. It is made of:

- one or more **payments**, on one or more accounts (€24 on a meal-voucher card and €12 by bank card);
- zero or more **refunds** (a works council benefit, public health insurance, a top-up insurer, a friend paying back their share).

"Where did the money go" counts the expense once, at its **net cost**; an account's own view shows its payments. The same model covers gift vouchers, gift cards and a shared bill.

A line can be **split** across several categories or subjects.

## Benefit accounts

Meal vouchers, works council subsidies, gift cards, a pot of money: money that is yours, but with **restricted use**.

- It is shown apart and does not count in the money available.
- A credit can carry an **expiry date**.
- Every account is kept in one of two **modes**:
  - **lines**: every expense imported or entered, with its merchant;
  - **balance**: the balance is noted each month, and the difference becomes one overall expense in a chosen category.
- A credit from the employer or the works council is an income of the benefit kind.
- A works council refund (the platform pays back part of a gym membership, say) is a transfer from the benefit account to the bank, linked to the expense it covers ("funded by the works council").

### The balance of a benefit account

The balance of a benefit account is not traced euro by euro, even when personal money was paid into it: a transfer from the current account to the meal-voucher card moves that money from "available" to "restricted". Dated credits expire in the order the issuer uses them up, **oldest first** by default.

### Top-ups beyond the cap

Some meal-voucher cards have a payment cap: beyond it, the issuer charges the rest to a linked bank card. The app matches the bank line and the benefit-account line (same moment, same issuer) and makes them **one expense**: groceries at Greenmarket, €80 = €28 on the MealCard + €52 by card.

Without the benefit account's history (balance mode), the match is impossible: the top-up goes to the account's overall category.

## Payment intermediaries

Payment services that stand between the buyer and the merchant: the bank's label names the intermediary, not the real merchant ("PAYLINK *PIXELPLAY"). The real merchant can be set by hand, and a rule remembers it.

## Merchants and rules

- A raw label ("CB GREENMARKET 2110 RIVERTON") becomes a **merchant** ("Greenmarket"), with its logo and its default category.
- **Rules** learn from every correction: correcting a line offers to write the rule, and the rule applies to what comes next and, on request, to the past.

## Subjects

What the money is spent **for**, beside the category, which says what **kind** of expense it is. Anything the user creates: Van, House, Garden shed, Alps 2028, Dog.

- **No templates.** A subject has a name and a parent, and two options:
  - **has a value**: an estimated value and its loan;
  - **has dates**: a start and an end.
- Subjects **nest**: Garden shed under House, and the cost of the shed rolls up into the cost of the house.
- An expense always has **one category**, and **zero, one or several subjects**. Most expenses have none.
- With several subjects, the expense counts **in full in each** (fuel bought during a holiday counts for the van and for the trip). Subject totals therefore never add up across subjects. To share an expense between subjects, split it.
- An expense attached to a subject and to its parent (Garden shed and House) counts only once in the parent.
- A subject's page: total cost, cost per month, breakdown by category, linked accounts and loans, documents.
- With dates (a trip, a renovation), the app proposes to attach the expenses of the period.
- A rule can attach a merchant to a subject (the fuel station → Van).
- A subject with a value is an **asset**: it carries an estimated value and its loan, and it feeds net worth.
- **No free tags** in V1: subjects cover grouping, and two overlapping mechanisms would confuse.

## Tax envelopes

An investment or savings account can sit in a **tax envelope** (a French PEA, a life insurance contract, a Livret A savings account…), whose rules are kept per account: a contribution cap, an opening date, a key date (the age after which a withdrawal no longer closes the plan, for a PEA). Gousset ships the rules for the PEA, life insurance and the Livret A; others can be defined by the user.

## Investments

- Positions by ISIN.
- Operations: contribution, purchase, sale, dividend, fee.
- Prices updated (the only call out of the server, [Nothing leaves the server](#nothing-leaves-the-server)).
- The gain.
- The **annualised return**, which takes the dates of the contributions into account.
- **Net contributions**: what came out of the user's pocket.

## V1

- **Accounts**: current, savings, card, securities account, PEA, loan. One currency per account.
- **Users**: several per installation, each with their own accounts.
- **Import**:
  - the standard formats: OFX and QFX, QIF, CAMT.053 (the European XML statement), MT940;
  - CSV, with an **import profile** per bank that maps each column to a field. The app ships profiles for common banks, and anyone can add their own and share it;
  - the same mechanism reads brokers' statements of operations;
  - **deduplication**: re-importing a period that overlaps the last one creates no duplicates;
  - **transfers between one's own accounts** detected (same amount, close dates) and linked in pairs.
- **Expenses paid in several parts, and refunds** ([An expense is not a bank line](#an-expense-is-not-a-bank-line)). Splitting a line across several categories or subjects.
- **Subjects** ([Subjects](#subjects)).
- **Benefit accounts**, in lines mode or balance mode ([Benefit accounts](#benefit-accounts)), with the expiry date of their credits.
- **Payment intermediaries** ([Payment intermediaries](#payment-intermediaries)).
- **The month's movements**: where money comes from and where it goes between accounts (salary → current account → PEA → ETF).
- **Merchants** from raw labels, and **rules** that learn from corrections.
- **Categories** on two levels, editable.
- **The monthly review.**
- **Where the money goes**: by category, by merchant and by subject, compared with the average and the previous month.
- **Subscriptions detected**: recurring payments, stops, price rises.
- **Spending benchmarks** ([Tracking, not envelopes](#tracking-not-envelopes)).
- **Investments** ([Investments](#investments)) and **tax envelopes** ([Tax envelopes](#tax-envelopes)).
- **Every screen works on a phone** (responsive), and in other languages and currencies. The interface is written in English and translated into French from the start.

## Later

- An alert before a benefit-account credit expires (the expiry date itself is in V1).
- Rare but predictable costs, spread as a sum set aside each month (a yearly domain renewal, say).
- Full net worth: accounts, investments, subjects with a value (estimated value minus the capital still owed).
- Simulating a large event (selling a home, say).
- Linking a line to a receipt or a contract, by URL or attachment.
- Accounts shared between two users.
- Import from Actual, Sure and Maybe.
- Optional bank sync, as a connector, for those who want it.

## Words

| Word | Meaning |
|---|---|
| expense | what happened, at its net cost; made of payments and refunds |
| payment | the part of an expense paid from one account |
| refund | money that comes back and cancels all or part of an expense |
| transfer | money moving between two of the user's own accounts |
| income | money coming in from outside |
| line | one line of a statement, as imported |
| merchant | who was paid, cleaned from the raw label |
| category | the kind of expense; exactly one per expense, on two levels |
| subject | what the money was spent for; zero or more per expense, nestable |
| asset | a subject with a value (and possibly a loan) |
| benefit account | money with restricted use, kept in lines or balance mode, credits possibly expiring |
| payment intermediary | a service whose name hides the real merchant in a label |
| tax envelope | the tax wrapper of an account (PEA, life insurance, Livret A…), with its rules |
| net contributions | what came out of the user's pocket into an investment account |
| annualised return | the yearly return, weighted by the dates of the contributions |
| benchmark | a suggested monthly mark for a category, not a budget |
| set aside | transfers to savings and investments in the month |
| monthly review | the home screen: the month read and what is left to review |
