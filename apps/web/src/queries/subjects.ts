import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getSubject, getSubjectMerchantsPreview, getSubjects } from "@/functions/subjects";

import { subjectKeys } from "./subject-keys";

// Kept in `invalidate`, which loads no server function, so that it can be tested alone.
export { invalidateSubjects } from "./invalidate";

/** The queries of the subjects page and of its sheet, for loaders and components alike. */
export const subjectQueries = {
  /** The subjects in tree order, each with its cost per month or its dates. */
  list: () => queryOptions({ queryKey: subjectKeys.list(), queryFn: () => getSubjects() }),
  /**
   * A subject's page for a year or all time; one the user does not have comes back as
   * `{ ok: false, code }`.
   */
  detail: (subjectId: string, period: number | "all") =>
    queryOptions({
      queryKey: subjectKeys.detail(subjectId, period),
      queryFn: () => getSubject({ data: { subjectId, period } }),
    }),
  /**
   * What the past expenses of the merchants `merchantIds` come to for the subject `subjectId`, those
   * it has and those declined for it aside (null for a new one); the last answer stays on screen
   * while the next one loads.
   */
  preview: (merchantIds: ReadonlyArray<string>, subjectId: string | null) =>
    queryOptions({
      queryKey: subjectKeys.preview(merchantIds, subjectId),
      queryFn: () =>
        getSubjectMerchantsPreview({ data: { merchantIds: [...merchantIds], subjectId } }),
      enabled: merchantIds.length > 0,
      placeholderData: keepPreviousData,
    }),
};
