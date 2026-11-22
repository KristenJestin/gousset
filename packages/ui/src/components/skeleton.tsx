import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { cn } from "../lib/utils";

/**
 * One grey shape standing for content on its way: a line of text, a bar, a figure. Only the
 * skeletons of `packages/ui` draw it, each shaped exactly like its loaded block; a page uses
 * those (`BreakdownSkeleton`…), never this one with classes of its own.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      data-slot="skeleton"
      className={cn("block animate-skeleton rounded-md bg-muted", className)}
    />
  );
}

/**
 * The frame of every block's skeleton (docs/architecture.md, "Data loading and skeletons"):
 * announced as loading, and invisible for its first 150 ms, then faded in, so a fast answer never
 * flashes it. In CSS only: no timer, nothing to clean up.
 *
 * Motion: waits 150 ms, fades in over 200 ms, then its shapes breathe (1.6 s); under reduced
 * motion it appears without a fade after the same wait, and stays still.
 */
export function SkeletonFrame({ label, children }: { label?: string; children: ReactNode }) {
  const messages = useUiMessages();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label ?? messages.loading}
      data-slot="skeleton-frame"
      className="animate-in fade-in fill-mode-both delay-150 duration-200"
    >
      {children}
    </div>
  );
}
