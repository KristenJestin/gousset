import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { Icon } from "./icon";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** A list of people or things, one per row. */
export function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y">
      {children}
    </ul>
  );
}

/**
 * One row of a `List`: its name, a second line, short tags, and at most one action at its end.
 * Where the tags and the action leave the name no room (a phone), they go under it.
 */
export function ListItem({
  title,
  description,
  tags = [],
  action,
}: {
  title: string;
  description?: string;
  tags?: Array<string>;
  /** One `Button` (secondary) acting on this row only, named so that it reads alone. */
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-foreground truncate text-sm font-medium">{title}</span>
        {description === undefined ? null : (
          <span className="text-muted-foreground truncate text-sm">{description}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {tags.map((tag) => (
          <span key={tag} className="bg-muted text-foreground rounded-md px-2 py-0.5 text-xs">
            {tag}
          </span>
        ))}
        {action}
      </div>
    </li>
  );
}

export type ListLinkItemProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "className" | "children" | "title"
> & {
  ref?: Ref<HTMLAnchorElement>;
  title: string;
  description?: string;
  tags?: Array<string>;
};

/**
 * One row of a `List` that opens what it names: the whole row is the link, its name first, then
 * its second line and tags, with a chevron at its end. The app makes it a router link with
 * TanStack Router's `createLink`. Its background shows on hover in 150 ms, cut under reduced motion.
 */
export function ListLinkItem({ title, description, tags = [], ...props }: ListLinkItemProps) {
  return (
    <li>
      <a
        {...props}
        className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-3 transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {description === undefined ? null : (
            <span className="truncate text-sm text-muted-foreground">{description}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {tags.map((tag) => (
            <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground">
              {tag}
            </span>
          ))}
          <span className="flex text-muted-foreground">
            <Icon name="next" size="sm" />
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * A `List` on its way: rows of the same height as `ListItem`'s (a name, a second line unless
 * `description` is false, a tag), so nothing moves when the data comes.
 */
export function ListSkeleton({
  rows = 3,
  description = true,
  label,
}: {
  rows?: number;
  description?: boolean;
  /** What is loading, said to screen readers; "Loading" otherwise. */
  label?: string;
}) {
  return (
    <SkeletonFrame label={label}>
      <ul className="flex flex-col divide-y" data-slot="list-skeleton">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-32" />
              </span>
              {description ? (
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-48 max-w-full" />
                </span>
              ) : null}
            </div>
            <Skeleton className="h-5 w-16 shrink-0" />
          </li>
        ))}
      </ul>
    </SkeletonFrame>
  );
}
