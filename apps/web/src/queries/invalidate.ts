import type { QueryClient } from "@tanstack/react-query";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { categoryKeys } from "./category-keys";
import { lineKeys } from "./line-keys";
import { merchantKeys } from "./merchant-keys";
import { monthKeys } from "./month-keys";
import { reviewKeys } from "./review-keys";
import { ruleKeys } from "./rule-keys";
import { subjectKeys } from "./subject-keys";

/**
 * Invalidates the queries of what a job or an action touched (docs/architecture.md): the
 * interface refetches what is on screen and drops the rest. A job's end carries it (`useJob`).
 * Whatever touched months touched their lines too, which the operations and the accounts show, and
 * the review counts, and the merchants an import recognises from them (#24), and the rules, which
 * count the lines they classified at import and applied to the past (#25). A rule applied to the
 * past (every month) moved lines between categories: their figures too. Every month is read again,
 * not only those touched: a month's figures read the six before it, and its flags the month after;
 * only the months on screen refetch. The subjects too: an import's rules and a rule applied to the
 * past attach them (#37).
 */
export async function invalidateTouched(queryClient: QueryClient, touched: Touched): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: ruleKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
    "everyMonth" in touched
      ? queryClient.invalidateQueries({ queryKey: categoryKeys.all })
      : Promise.resolve(),
  ]);
}

/**
 * After a write to an account (create, edit, close, reopen, a noted balance): the list's groups and
 * totals and the account's page may all have changed, so every accounts query is read again; the
 * operations name each line's account, so theirs are too, and the review counts the accounts. The
 * months read the accounts (kind, name, closing, how far imported, expiring credits): all of them.
 * A subject's page gives its accounts' balances (#37).
 */
export async function invalidateAccounts(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
  ]);
}

/**
 * After a subject is made or changed, or expenses attached to it or declined (#37): every subjects
 * query is read again (a parent counts its children's), the rules (its merchants are rules), the
 * operations and the accounts' pages (their lines name each expense's subjects) and every month
 * (its "by subject").
 */
export async function invalidateSubjects(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
    queryClient.invalidateQueries({ queryKey: ruleKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
  ]);
}

/**
 * After a line is attached to a subject as what pays it back, or detached (#217): its entry goes or
 * comes back, an income, so the subjects' and the operations' queries, the months, the categories'
 * figures (it was in an income category) and the review's counts are read again.
 */
export async function invalidatePaybacks(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateSubjects(queryClient),
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
  ]);
}

/**
 * After a change of the categories or of a line's category: the categories' figures and lines,
 * each line's category (the operations name it), the months' spending by category, and the
 * merchants' default categories (a merge moves them, an archive marks them) may all have changed,
 * so each is read again; and the subjects, whose pages give their cost by category (#37).
 */
export async function invalidateCategories(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
  ]);
}

/**
 * After a rename: the lists (names, order) and the merchants' pages may all have changed, so every
 * merchants query is read again, and every month, which names the merchants and their
 * intermediaries, and the subjects, whose pages name their merchants (#37). A merge, a label moved
 * or a default category set move entries too: `invalidateMerchantEntries`.
 */
export async function invalidateMerchants(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
  ]);
}

/**
 * Invalidates what a merchant's merge, a cleaned label moved or a default category set changes:
 * the merchants, and the entries the server moved to a merchant's default category (#23), which
 * the operations, the months' spending and the categories' figures show, and the subjects' pages,
 * which give their merchants and their cost by category (#37).
 */
export async function invalidateMerchantEntries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
  ]);
}
