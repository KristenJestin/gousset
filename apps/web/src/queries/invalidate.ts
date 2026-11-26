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
 * operations (they name each expense's subjects) and every month (its "by subject").
 */
export async function invalidateSubjects(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
    queryClient.invalidateQueries({ queryKey: ruleKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
  ]);
}

/**
 * After a rename: the lists (names, order) and the merchants' pages may all have changed, so every
 * merchants query is read again, and every month, which names the merchants and their
 * intermediaries. A merge, a label moved or a default category set move entries too:
 * `invalidateMerchantEntries`.
 */
export async function invalidateMerchants(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
  ]);
}

/**
 * Invalidates what a merchant's merge, a cleaned label moved or a default category set changes:
 * the merchants, and the entries the server moved to a merchant's default category (#23), which
 * the operations, the months' spending and the categories' figures show.
 */
export async function invalidateMerchantEntries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
  ]);
}
