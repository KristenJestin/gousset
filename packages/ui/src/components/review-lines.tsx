import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { transition } from "../lib/motion";
import { Amount, AmountSkeleton } from "./amount";
import { Button } from "./button";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type ReviewLine = {
  id: string;
  /** The bank's raw label, as imported: "PAYLINK *PIXELPLAY". */
  label: string;
  /** What the rules made of it: the merchant, or the label again when they found none. */
  title: string;
  /** What else the rules proposed, short: its category, its account. */
  tags: ReadonlyArray<string>;
  amount: Money;
};

export type ReviewLinesProps = {
  lines: ReadonlyArray<ReviewLine>;
  /** The action's word on each row: "Approve". */
  approveText: string;
  /** The action's name for screen readers, for one line: "Approve PAYLINK *PIXELPLAY". */
  approveLabel: (line: ReviewLine) => string;
  onApprove: (id: string) => void;
  /** Show this many lines, then "+ N more". All of them when left out. */
  limit?: number;
  /** Show the rest: "+ N more" becomes a button, "Show the other N". */
  onMore?: () => void;
  /** What the list is, for screen readers. */
  label: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

function More({ count, onMore }: { count: number; onMore: (() => void) | undefined }) {
  const messages = useUiMessages().money;

  return (
    <li className="flex h-10 items-center text-sm text-muted-foreground">
      {onMore === undefined ? (
        messages.moreRows(count)
      ) : (
        <button
          type="button"
          className="-mx-2 cursor-pointer rounded-md px-2 transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onMore}
        >
          {messages.showOtherRows(count)}
        </button>
      )}
    </li>
  );
}

/**
 * The lines the rules were not sure of (docs/wireframes, screen 1, block 5): each with its raw
 * label, what the rules made of it (merchant, category, account), its amount and the action that
 * approves it. Cut after `limit` lines with "+ N more".
 *
 * Motion: an approved line fades out (200 ms, ease-out) and the lines under it slide up into its
 * place (a layout move, by transform: nothing is laid out again at each frame); a line put back
 * fades in while the others slide down. Cut under reduced motion.
 */
export function ReviewLines({
  lines,
  approveText,
  approveLabel,
  onApprove,
  limit,
  onMore,
  label,
  locale,
}: ReviewLinesProps) {
  const shown = limit === undefined ? lines.length : Math.max(0, limit);
  const hidden = lines.length - Math.min(shown, lines.length);
  // The lines of the first render are drawn as they are, with no style attribute in the server's
  // markup (the Content Security Policy forbids them); only a line that comes later unfolds.
  const [first] = useState(() => new Set(lines.map((line) => line.id)));

  const unfolds = (id: string) =>
    first.has(id)
      ? {}
      : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  return (
    <ul aria-label={label} data-slot="review-lines" className="relative flex flex-col">
      {/* The line that leaves is taken out of the flow at once; the others move up by layout. */}
      <AnimatePresence initial={false} mode="popLayout">
        {lines.slice(0, shown).map((line) => (
          <motion.li
            key={line.id}
            data-slot="review-line"
            layout="position"
            className="border-b bg-card last:border-b-0"
            {...unfolds(line.id)}
            exit={{ opacity: 0 }}
            transition={transition.base}
          >
            <div className="flex h-16 items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {line.label}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-medium">{line.title}</span>
                  {line.tags.map((tag) => (
                    <span
                      key={tag}
                      className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              </div>
              <Amount value={line.amount} size="sm" roll={false} locale={locale} />
              <Button
                variant="secondary"
                size="sm"
                aria-label={approveLabel(line)}
                onClick={() => onApprove(line.id)}
              >
                {approveText}
              </Button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
      {hidden > 0 ? <More count={hidden} onMore={onMore} /> : null}
    </ul>
  );
}

/** `ReviewLines` on its way: as many lines as it will show and, with `more`, the last line. */
export function ReviewLinesSkeleton({ rows = 3, more = false }: { rows?: number; more?: boolean }) {
  return (
    <SkeletonFrame>
      <ul className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex h-16 items-center gap-3">
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-4 w-28" />
            </span>
            <AmountSkeleton size="sm" />
            <Skeleton className="h-8 w-20" />
          </li>
        ))}
        {more ? (
          <li className="flex h-10 items-center">
            <Skeleton className="h-4 w-24" />
          </li>
        ) : null}
      </ul>
    </SkeletonFrame>
  );
}
