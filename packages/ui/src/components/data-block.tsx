import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Skeleton, SkeletonFrame } from "./skeleton";

// A block of data on a page and the states it goes through while its data loads
// (docs/architecture.md, "Data loading and skeletons"). Its error state is `ErrorState`, its
// amounts `Amount`; its rows have their own skeleton below.

/** One block of a page: a title, then its data. Never a block inside a block. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="bg-card text-card-foreground flex w-full flex-col gap-3 rounded-lg border p-6"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** The rows of a block. Every row has the same height, so a skeleton can take their exact place. */
export function FigureList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {children}
    </ul>
  );
}

/** One row: a name, a second line maybe, a figure, an action maybe. Always `h-12`. */
export function FigureRow({
  label,
  detail,
  figure,
  action,
}: {
  label: string;
  detail?: string;
  figure: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex h-12 items-center gap-3">
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-sm">{label}</span>
        {detail === undefined ? null : (
          <span className="text-muted-foreground truncate text-xs">{detail}</span>
        )}
      </div>
      <span className="shrink-0 text-sm font-medium">{figure}</span>
      {action}
    </li>
  );
}

/** A last row that says what the block does not show. Same height as a `FigureRow`. */
export function FigureMore({ children }: { children: ReactNode }) {
  return <li className="text-muted-foreground flex h-12 items-center text-sm">{children}</li>;
}

const subscribeToNothing = () => () => {};

/**
 * A `FigureList` on its way: `rows` rows shaped like `FigureRow`, and a last one like `FigureMore`
 * when `more`, so that nothing moves when the data arrives. In a `SkeletonFrame`: announced as
 * loading, invisible for 150 ms, then faded in; under reduced motion it appears without the fade.
 */
export function FigureListSkeleton({ rows, more = false }: { rows: number; more?: boolean }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col">
        {Array.from({ length: rows + (more ? 1 : 0) }, (_, row) => (
          <div key={row} aria-hidden="true" className="flex h-12 items-center">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/**
 * Fades its content in when it replaces a skeleton in the browser. Content the server rendered
 * (the first visit) is shown as it is, without a fade: during hydration React reads the server's
 * value (`false`), and the state keeps the value of the first render.
 */
export function FadeIn({ children }: { children: ReactNode }) {
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const [fades] = useState(inBrowser);

  return <div className={cn(fades && "animate-in fade-in duration-200")}>{children}</div>;
}
