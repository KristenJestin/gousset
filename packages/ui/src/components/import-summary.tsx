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
  /** The page's buttons: "Undo", "Continue to the review". */
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
    <div data-figure={slot} className="flex flex-col-reverse gap-0.5">
      <dt className="text-sm text-muted-foreground">{figure.label}</dt>
      <dd
        className={cn(
          "text-2xl font-semibold tracking-tight text-foreground",
          stands && "text-primary",
        )}
      >
        <RollingCount value={figure.count} locale={locale} />
      </dd>
    </div>
  );
}

/**
 * An import's summary before moving on to the review (docs/wireframes, screen 6, block 4): the
 * lines read, those added, those the app already had, and those held as near duplicates for the
 * review, with a note under them when the page gives one; then the page's actions. Every word is the page's; it writes the counts in the page's
 * language, in tabular figures. It draws no block: the page puts it in one.
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
  const figures = (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
      <Figure figure={read} slot="read" stands={false} locale={locale} />
      <Figure figure={added} slot="added" stands={false} locale={locale} />
      <Figure figure={known} slot="known" stands={false} locale={locale} />
      <Figure figure={review} slot="review" stands={review.count > 0} locale={locale} />
    </dl>
  );

  return (
    <Unfold>
      <section
        aria-label={label}
        data-slot="import-summary"
        className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
      >
        {note === undefined ? (
          figures
        ) : (
          <div className="flex flex-col gap-4">
            {figures}
            <p
              data-slot="import-summary-note"
              className="max-w-prose text-sm text-muted-foreground"
            >
              {note}
            </p>
          </div>
        )}
        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </section>
    </Unfold>
  );
}
