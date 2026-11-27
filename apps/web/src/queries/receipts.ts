import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getReceiptLimits, getSubjectReceipts } from "@/functions/receipts";

import { lineKeys } from "./line-keys";
import { subjectKeys } from "./subject-keys";

/** The receipts' queries (#217): the installation's limits, and a subject's receipts. */
export const receiptQueries = {
  /** What a receipt may be, the same for the whole session. */
  limits: () =>
    queryOptions({
      queryKey: ["receipts", "limits"] as const,
      queryFn: () => getReceiptLimits(),
      staleTime: Number.POSITIVE_INFINITY,
    }),
  /** Every receipt of a subject's lines; one the user does not have comes back as a refusal. */
  ofSubject: (subjectId: string) =>
    queryOptions({
      queryKey: subjectKeys.receipts(subjectId),
      queryFn: () => getSubjectReceipts({ data: { subjectId } }),
    }),
};

/**
 * After a receipt is attached or deleted: its line's detail lists it, and every subject's page its
 * lines' (a line's subjects are read on the server, so all of them).
 */
export async function invalidateReceipts(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: subjectKeys.all }),
  ]);
}
