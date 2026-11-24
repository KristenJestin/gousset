import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { RollingCount } from "./rolling-digits";
import { Unfold } from "./unfold";

/** One figure of the summary: its count and what it counts, in the page's words. */
export type ImportSummaryFigure = { label: string; count: number };

export type ImportSummaryProps = {
  /** What the summary is, for screen readers ("Import summary"). */
  label: string;
  /** Every line the files held. */
  read: ImportSummaryFigure;
  /** Lines added to the app. */
  added: ImportSummaryFigure;
  /** Lines skipped: the app already had them. */
  known: ImportSummaryFigure;
  /** Lines held as near duplicates, for the review. Stands out while there are some. */
  review: ImportSummaryFigure;
  /**
   * One sentence under the figures, when the import has something to say beyond its counts ("This
   * file's balance looks empty and was ignored").
   */
  note?: string;
  /**
   * The page's actions, the way forward last: a quiet "Undo this import" (`Button`, `quiet`), then
   * "Continue to the review" (`ButtonLink`, primary). At the right edge on a wide screen, the two
   * set apart; on a phone stacked under the figures, full width, the way forward on top.
   */
  actions?: ReactNode;
  /** The page's language (`<html lang>`) unless given: it writes the counts. */
  locale?: string;
};

function Figure({
  figure,
  slot,
  stands,
  locale,
}: {
  figure: ImportSummaryFigure;
  slot: string;
  stands: boolean;
  locale: string | undefined;
}) {
  return (
    <div data-figure={slot} className="flex flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{figure.label}</dt>
      <dd
        className={cn(
          "text-base font-semibold text-foreground tabular-nums",
          stands && "text-primary",
        )}
      >
        <RollingCount value={figure.count} locale={locale} />
      </dd>
    </div>
  );
}

/**
 * An import's summary before moving on to the review (docs/wireframes, screen 6, block 4), on an
 * inset under its file's row: the lines read, those added, those the app already had, and those
 * held as near duplicates for the review, as one group, with a note under them when the page
 * gives one; then the page's actions. Every word is the page's; it writes the counts in the page's
 * language, in tabular figures.
 *
 * Screen readers hear each count whole, never a digit on its way. It is no live region: the
 * import's `JobProgress` already announces its end.
 *
 * Motion: it unfolds when it first appears (revealed from its top and faded in, 250 ms, ease-out), and each
 * count rolls from its previous value to the new one as `Amount`'s digits do (200 ms). Cut under
 * reduced motion: it appears, the numbers jump.
 */
export function ImportSummary({
  label,
  read,
  added,
  known,
  review,
  note,
  actions,
  locale,
}: ImportSummaryProps) {
  return (
    <Unfold>
      <section
        aria-label={label}
        data-slot="import-summary"
        className="flex flex-col gap-4 rounded-md bg-muted/70 p-3 md:flex-row md:flex-wrap md:items-center md:gap-x-6 md:pl-4"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
            <Figure figure={read} slot="read" stands={false} locale={locale} />
            <Figure figure={added} slot="added" stands={false} locale={locale} />
            <Figure figure={known} slot="known" stands={false} locale={locale} />
            <Figure figure={review} slot="review" stands={review.count > 0} locale={locale} />
          </dl>
          {note === undefined ? null : (
            <p data-slot="import-summary-note" className="max-w-prose text-xs text-soft-foreground">
              {note}
            </p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex flex-col-reverse gap-2 md:ml-auto md:shrink-0 md:flex-row md:items-center md:gap-4">
            {actions}
          </div>
        )}
      </section>
    </Unfold>
  );
}
