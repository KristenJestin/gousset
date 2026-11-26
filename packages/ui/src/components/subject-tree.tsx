import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { cn } from "../lib/utils";
import { Chip } from "./chip";
import { Skeleton, SkeletonFrame } from "./skeleton";

// The subjects' screen (docs/wireframes, screen 5): their tree in a column, the chosen subject's
// page beside it; on a phone the tree first, the page under it.

/**
 * The subjects' screen: `tree` in a column of its own beside the subject's page (`children`) from
 * 768 px on, the two one under the other on a phone.
 */
export function SubjectsLayout({ tree, children }: { tree: ReactNode; children: ReactNode }) {
  return (
    <div data-slot="subjects-layout" className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="flex shrink-0 flex-col md:w-64">{tree}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}

export type SubjectHeadingProps = {
  /** The subject's name: the page's heading under the screen's title. */
  name: string;
  /** Short words beside the name, already worded: "has a value", its dates, "archived". */
  tags?: ReadonlyArray<string>;
  /** At the end of the line: the period's choice, the button that opens its sheet. */
  actions?: ReactNode;
};

/**
 * The head of a subject's page (docs/wireframes, screen 5): its name and what it is (has a value,
 * its dates, archived), then its period's choice and "Edit" at the end of the line; on a phone
 * they go under the name when the line is full.
 */
export function SubjectHeading({ name, tags = [], actions }: SubjectHeadingProps) {
  return (
    <header data-slot="subject-heading" className="flex flex-wrap items-center gap-3">
      <h2 className="min-w-0 truncate text-lg font-semibold">{name}</h2>
      {tags.map((tag) => (
        <Chip key={tag}>{tag}</Chip>
      ))}
      {actions === undefined ? null : (
        <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export type SubjectTreeProps = {
  /** What the tree is, its heading and its navigation's name ("Your subjects"). */
  label: string;
  /** Beside the heading: the button that makes a subject ("New"). */
  action?: ReactNode;
  /** `SubjectTreeItem`s, in tree order: each parent before its children. */
  children: ReactNode;
};

/**
 * The user's subjects as a tree (docs/wireframes, screen 5, block 1): each a link to its page, its
 * children indented under it, its cost per month or its dates at the end, an archived one marked.
 * The subject shown is the current link (`aria-current="page"`, set by the router).
 */
export function SubjectTree({ label, action, children }: SubjectTreeProps) {
  return (
    <nav
      aria-label={label}
      data-slot="subject-tree"
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground"
    >
      <div className="flex min-h-8 items-center justify-between gap-2 ps-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        {action}
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </nav>
  );
}

/** How far a row is indented, by its depth; deeper ones stay at the last step. */
const INDENT = ["ps-2", "ps-6", "ps-10", "ps-14", "ps-18"] as const;

export type SubjectTreeItemProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "className" | "children"
> & {
  ref?: Ref<HTMLAnchorElement>;
  name: string;
  /** 0 at the top: a child is indented under its parent. */
  depth: number;
  /** At the end of the row, already worded: "€165/month", "3–17 Jul. 2028". */
  figure: string;
  archived?: boolean;
};

/**
 * One subject of a `SubjectTree`: a link to its page, the app's router link (`createLink`). The
 * current one stands out. Its background shows on hover in 150 ms, cut under reduced motion; its
 * focus ring is drawn inside, the rows touching each other.
 */
export function SubjectTreeItem({
  name,
  depth,
  figure,
  archived = false,
  ...props
}: SubjectTreeItemProps) {
  const messages = useUiMessages().subjects;

  return (
    <li>
      <a
        {...props}
        data-slot="subject-row"
        data-depth={depth}
        data-archived={archived ? "" : undefined}
        className={cn(
          "flex h-10 items-center gap-2 rounded-md pe-2 text-sm transition-colors duration-150 ease-out hover:bg-muted",
          "aria-[current=page]:bg-muted aria-[current=page]:font-medium",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          INDENT[Math.min(depth, INDENT.length - 1)],
          archived ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {archived ? <Chip>{messages.archived}</Chip> : null}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{figure}</span>
      </a>
    </li>
  );
}

/** A `SubjectTree` on its way: its heading's place and `rows` rows of the same height. */
export function SubjectTreeSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
        <div className="flex min-h-8 items-center ps-2">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex h-10 items-center justify-between gap-2 px-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonFrame>
  );
}
