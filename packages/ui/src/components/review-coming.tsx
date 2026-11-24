import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon";

// The monthly review until it reads the user's own lines (#126): one block that says what the
// review will hold and leads to what works today. Nothing in it is a figure: no chart, no
// skeleton, since no data is on its way.

/** The four parts of the month, each in the colour the review keeps for it. */
export type ReviewPart = "income" | "spent" | "saved" | "left";

const SWATCHES = {
  income: "bg-money-income",
  spent: "bg-money-spent",
  saved: "bg-money-saved",
  left: "bg-money-left",
} satisfies { [part in ReviewPart]: string };

export type ReviewComingProps = {
  /** "Your monthly review is not ready yet". */
  title: string;
  /** What the review will do, and that nothing here is invented. */
  description: string;
  /** The parts' accessible name ("What the review will hold"). */
  partsLabel: string;
  /** The four parts, in the month bar's order, each a word and a line. */
  parts: ReadonlyArray<{ part: ReviewPart; title: string; description: string }>;
  /** The heading over the links ("What works today"). */
  linksTitle: string;
  /** `ReviewComingLink`s, the first thing to do first. */
  children: ReactNode;
};

/**
 * The review's empty state, the width of the page: its title and why it is empty, the four parts
 * the review will hold (in words, each with its colour), then the screens that work today.
 *
 * Motion: none on load, nothing counts up. Its links have their own (`ReviewComingLink`).
 */
export function ReviewComing({
  title,
  description,
  partsLabel,
  parts,
  linksTitle,
  children,
}: ReviewComingProps) {
  return (
    <section
      aria-labelledby="review-coming-title"
      data-slot="review-coming"
      className="flex flex-col rounded-lg border bg-card text-card-foreground"
    >
      <header className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Icon name="review" size="lg" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="review-coming-title" className="text-base font-semibold">
            {title}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      <dl
        aria-label={partsLabel}
        className="grid grid-cols-1 gap-3.5 px-4 pb-4 sm:grid-cols-2 sm:px-5 sm:pb-5 lg:grid-cols-4"
      >
        {parts.map((part) => (
          // A `dl` holds only its `dt` and `dd` pairs, each in one `div`: the swatch goes in the term.
          <div key={part.part} className="flex flex-col">
            <dt className="flex items-center gap-2.5 text-sm font-medium">
              <span
                aria-hidden
                data-part={part.part}
                className={cn("size-2.5 shrink-0 rounded-full", SWATCHES[part.part])}
              />
              {part.title}
            </dt>
            <dd className="pl-5 text-xs text-muted-foreground">{part.description}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t">
        <h3 className="px-4 pt-3.5 pb-1.5 text-xs font-medium text-muted-foreground sm:px-5">
          {linksTitle}
        </h3>
        <ul aria-label={linksTitle} className="flex flex-col pb-2">
          {children}
        </ul>
      </div>
    </section>
  );
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
  ref?: Ref<HTMLAnchorElement>;
};

export type ReviewComingLinkProps = AnchorProps & {
  icon: IconName;
  /** The screen, or what to do there ("Import your first statement"). */
  title: string;
  /** What the screen does; on a phone it gives way to `count`. */
  description?: string;
  /** The user's own count there ("5 accounts", "None yet"), at the row's end, under the title on a phone. */
  count?: string;
  /** The one thing to do first (a new user's first import): in the accent. */
  first?: boolean;
};

/**
 * One row of `ReviewComing`, a single link to a screen (the app wraps it with its router's link,
 * as `AccountRow`).
 *
 * Motion: on hover the row takes the muted band (150 ms) and its chevron moves 2 px to the right
 * (150 ms, ease-out). Under reduced motion, the band only, at once.
 */
export function ReviewComingLink({
  icon,
  title,
  description,
  count,
  first = false,
  ...anchorProps
}: ReviewComingLinkProps) {
  return (
    <li>
      <a
        {...anchorProps}
        data-first={first || undefined}
        className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted sm:px-5"
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            first ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon name={icon} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("text-sm font-medium", first && "text-primary")}>{title}</span>
            {description === undefined ? null : (
              <span className="hidden text-xs text-muted-foreground sm:block">{description}</span>
            )}
          </span>
          {count === undefined ? null : (
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </span>
        <span
          data-slot="review-coming-chevron"
          className="text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
        >
          <Icon name="next" />
        </span>
      </a>
    </li>
  );
}
