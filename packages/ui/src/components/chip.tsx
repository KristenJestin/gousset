import type { ReactNode } from "react";

/**
 * A plain neutral pill of words beside a name: an envelope ("PEA"), an institution, a group. No
 * icon, never selected nor removable; for an account's kind with its icon, use `AccountChip`.
 */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 max-w-full items-center truncate rounded-full bg-muted px-2 text-xs font-medium text-foreground">
      {children}
    </span>
  );
}
