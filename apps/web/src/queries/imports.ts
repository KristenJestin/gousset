import { queryOptions } from "@tanstack/react-query";

import { getCsvQuestions, getImport, getImportAccounts, listImports } from "@/functions/imports";

/**
 * The imports domain's query keys (docs/architecture.md, "Data loading and skeletons"): the list,
 * each import, the accounts a file may go to, and a waiting CSV's questions.
 */
export const importKeys = {
  all: ["import"] as const,
  list: () => [...importKeys.all, "list"] as const,
  one: (id: string) => [...importKeys.all, "one", id] as const,
  accounts: () => [...importKeys.all, "accounts"] as const,
  csv: (id: string) => [...importKeys.all, "csv", id] as const,
};

export const importQueries = {
  /** The latest imports, newest first: the screen's rows, kept across a reload. */
  list: () =>
    queryOptions({
      queryKey: importKeys.list(),
      queryFn: () => listImports({ data: { before: null } }),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: importKeys.one(id),
      queryFn: () => getImport({ data: { importId: id } }),
    }),
  accounts: () =>
    queryOptions({
      queryKey: importKeys.accounts(),
      queryFn: () => getImportAccounts(),
    }),
  csv: (id: string) =>
    queryOptions({
      queryKey: importKeys.csv(id),
      queryFn: () => getCsvQuestions({ data: { importId: id } }),
      staleTime: Infinity,
    }),
};
