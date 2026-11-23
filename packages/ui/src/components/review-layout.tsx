import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { Skeleton } from "./skeleton";

// The monthly review's pieces (docs/wireframes, screens 1 and 11): the state line under the
// page's title, then its blocks on a grid, in the order the screen reads them. The page itself is
// the frame's `Page`, the month switcher beside its title.

export type ReviewStatusProps = {
  /** How far the month's statements are imported, and the link to the lines to review. */
  status: ReactNode;
  /** Under it, what the screen shows when it is not the user's own data: "Made-up data…". */
  notice?: string;
};

/**
 * The review's state line (screen 1, the header): the state of the imports and the link down to
 * the lines to review, `StatusPiece`s separated by dots; under it, a notice when the data is not
 * the user's own. It holds the height of one line on a wide screen and of two on a phone, where
 * its pieces wrap, so that the blocks under it stay where they are while its data loads.
 */
export function ReviewStatus({ status, notice }: ReviewStatusProps) {
  return (
    <div className="-mt-3 flex flex-col gap-1.5">
      <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground md:min-h-5">
        {status}
      </div>
      {notice === undefined ? null : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="info" size="sm" />
          {notice}
        </p>
      )}
    </div>
  );
}

/** One piece of the header's state line; a small dot separates it from the one before. */
export function StatusPiece({ children }: { children: ReactNode }) {
  return (
    <span className="group/status inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-1 rounded-full bg-muted-foreground group-first/status:hidden"
      />
      {children}
    </span>
  );
}

/** A link down the page, to a block's `anchor`: "6 lines to review ↓". */
export function JumpLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
      <Icon name="expand" size="sm" />
    </a>
  );
}

/** The review's blocks under the month bar: two columns on a wide screen, one on a phone. */
export function ReviewGrid({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-11">{children}</div>;
}

export type ReviewCellProps = {
  /** `main`: the wider left column; `side`: the right one, its blocks stacked. */
  column: "main" | "side";
  /** On a phone, after every other block: the lines to review come last there. */
  lastOnPhone?: boolean;
  children: ReactNode;
};

/** A cell of `ReviewGrid`: one block, or the side's stacked blocks. */
export function ReviewCell({ column, lastOnPhone = false, children }: ReviewCellProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 md:gap-5",
        column === "main" ? "lg:col-span-6" : "lg:col-span-5",
        lastOnPhone && "max-lg:order-last",
      )}
    >
      {children}
    </div>
  );
}

/** `CountChip` while its count loads: the same size, so the block's title line keeps its height. */
export function CountChipSkeleton() {
  return <Skeleton className="h-5 w-5 rounded-full" />;
}

/** A small rounded count after a block's title: the lines to review. */
export function CountChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium">
      {children}
    </span>
  );
}
