/**
 * The month domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key of a month starts with `monthKeys.of(month)`, so that one call reaches
 * all of a month's queries, and `monthKeys.all` every month's: what a job touched is read again
 * by them (`invalidateTouched`). The review's own queries come back with the review (v0.4).
 */
export const monthKeys = {
  all: ["month"] as const,
  of: (month: string) => [...monthKeys.all, month] as const,
};
