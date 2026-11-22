import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Icon } from "./icon";

// The monthly review's frame (docs/wireframes, screens 1 and 11): its header, then its blocks on a
// grid, in the order the screen reads them. Until the app's frame comes (#8), the page stands alone.

/** The review's page: its column, centred, wide on a desktop, edge to edge on a phone. */
export function ReviewPage({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:gap-5 md:p-8">
        {children}
      </div>
    </main>
  );
}

export type ReviewHeaderProps = {
  /** The page's heading, for screen readers: "October 2026"; the switcher shows it. */
  title: string;
  /** The month and its arrows: a `MonthSwitcher`. */
  month: ReactNode;
  /** How far the month's statements are imported, and the link to the lines to review. */
  status?: ReactNode;
  /** At the end of the line, the page's main action. */
  action?: ReactNode;
  /** Under it, what the screen shows when it is not the user's own data: "Made-up data…". */
  notice?: string;
};

/**
 * The review's header (block "header" of the wireframes): the month with its arrows, the state of
 * the imports and the link down to the lines to review, and the page's action. On a phone the
 * month comes first, alone on its line, and the state goes under it.
 */
export function ReviewHeader({ title, month, status, action, notice }: ReviewHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="sr-only">{title}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-base">{month}</div>
        {status === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground max-md:order-last max-md:w-full">
            {status}
          </div>
        )}
        {action === undefined ? null : <div className="ml-auto">{action}</div>}
      </div>
      {notice === undefined ? null : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="info" size="sm" />
          {notice}
        </p>
      )}
    </header>
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

/** A small rounded count after a block's title: the lines to review. */
export function CountChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium">
      {children}
    </span>
  );
}
