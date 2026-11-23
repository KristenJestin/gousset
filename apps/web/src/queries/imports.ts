import type { CsvProfile } from "@gousset/import";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getImportProfilesFor, listImportProfiles } from "@/functions/import-profiles";
import {
  getCsvPreview,
  getCsvQuestions,
  getImport,
  getImportAccounts,
  listImports,
} from "@/functions/imports";

/**
 * The imports domain's query keys (docs/architecture.md, "Data loading and skeletons"): the list,
 * each import, the accounts a file may go to, a waiting CSV's questions and its preview with a
 * profile, and the import profiles.
 */
export const importKeys = {
  all: ["import"] as const,
  list: () => [...importKeys.all, "list"] as const,
  one: (id: string) => [...importKeys.all, "one", id] as const,
  accounts: () => [...importKeys.all, "accounts"] as const,
  csv: (id: string) => [...importKeys.all, "csv", id] as const,
  preview: (id: string, profile: CsvProfile) =>
    [...importKeys.all, "preview", id, profile] as const,
  profiles: () => [...importKeys.all, "profiles"] as const,
  profilesFor: (id: string) => [...importKeys.profiles(), id] as const,
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
  /**
   * The file read with the profile being made: the last result stays shown while the next one is
   * read, so that the preview does not blink at each change.
   */
  preview: (id: string, profile: CsvProfile) =>
    queryOptions({
      queryKey: importKeys.preview(id, profile),
      queryFn: () => getCsvPreview({ data: { importId: id, profile } }),
      staleTime: Infinity,
      placeholderData: keepPreviousData,
    }),
  /** The user's profiles, then the shipped ones. */
  profiles: () =>
    queryOptions({
      queryKey: importKeys.profiles(),
      queryFn: () => listImportProfiles(),
    }),
  /** The profiles that read the import's file. */
  profilesFor: (id: string) =>
    queryOptions({
      queryKey: importKeys.profilesFor(id),
      queryFn: () => getImportProfilesFor({ data: { importId: id } }),
    }),
};
