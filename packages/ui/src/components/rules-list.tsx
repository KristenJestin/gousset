import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { focusRing } from "../lib/form-classes";
import type { RuleConditions } from "../lib/rule-fields";
import type { UiMessages } from "../lib/messages";
import { conditionsSentence } from "../lib/rule-sentence";
import type { RuleAccountName, RuleMerchantName } from "../lib/rule-sentence";
import { staggerDelay } from "../lib/stagger";
import { cn } from "../lib/utils";
import { Chip } from "./chip";
import { IconButton } from "./icon-button";
import { Skeleton, SkeletonFrame } from "./skeleton";

// The rules of the settings (docs/wireframes, screen 9, block 2): rules as sentences, "if…
// then…", in the order they are tried, with how many lines each classified. Rows are flex rows,
// as the other lists of packages/ui; the column titles are only drawn, each row saying its own.

export type RulesListRow = {
  id: string;
  conditions: RuleConditions;
  /** The merchant it sets, by name; none when it sets only a category. */
  merchant: string | null;
  /** The category it sets, by its path ("Food › Groceries"); none when it sets only a merchant. */
  category: string | null;
  /** Its category is archived: it classifies nothing new, and says so. */
  categoryArchived?: boolean;
  /** The subject it attaches, by its path ("House > Garden shed"); none for most rules. */
  subject?: string | null;
  /** Its subject is archived: it attaches it to nothing new, and says so. */
  subjectArchived?: boolean;
  /** Off: kept in its place, classifying nothing new. */
  enabled: boolean;
  /** How many lines it classified. */
  used: number;
  /**
   * Moved just now, one place up or down: it slides in from where it was. `turn` counts the moves,
   * so that each one slides in again.
   */
  moved?: { direction: "up" | "down"; turn: number };
};

export type RulesListProps = {
  /** What the list is, for screen readers ("Rules, in the order they are tried"). */
  label: string;
  rules: ReadonlyArray<RulesListRow>;
  /** The accounts a condition may name, as the page calls them. */
  accounts: ReadonlyArray<RuleAccountName>;
  /** The merchants the conditions name, by name. */
  merchants?: ReadonlyArray<RuleMerchantName>;
  /** Opens a rule, to edit it. */
  onOpen: (id: string) => void;
  /** Moves a rule to `place` (from 1); a promise keeps its button busy until it settles. */
  onMove: (id: string, place: number) => Promise<void> | void;
  /** The rule open in its sheet, over the list. */
  openId?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

const COLUMN = {
  if: "flex min-w-0 flex-1 flex-col gap-0.5",
  then: "hidden w-56 shrink-0 md:flex md:flex-wrap md:items-center md:gap-1.5",
  used: "w-20 shrink-0 text-right tabular-nums",
  order: "flex w-16 shrink-0 justify-end",
};

/**
 * A row that came in anew after a move: the focus, lost with the old row's arrow, goes to its own
 * arrow that can still be pressed.
 */
function keepFocus(row: HTMLLIElement | null) {
  if (
    row !== null &&
    (document.activeElement === null || document.activeElement === document.body)
  ) {
    row.querySelector<HTMLButtonElement>("[data-move]:not([disabled])")?.focus();
  }
}

/** What a rule sets, worded: "Greenmarket · Groceries", "Fuelstop · for Van". */
function thenOf(row: RulesListRow, messages: UiMessages["rules"]): string {
  const subject = row.subject ?? null;

  return [row.merchant, row.category, subject === null ? null : messages.forSubject(subject)]
    .filter((each) => each !== null)
    .join(" · ");
}

/**
 * The user's rules in the order they are tried (the first that applies wins): each as a sentence,
 * "if" its conditions "then" its merchant, category and subject, with how many lines it changed. A
 * rule turned off is drawn faded with "Off"; one whose category or subject was archived says so. Pressing a rule
 * opens it (`onOpen`); its arrows move it one place up or down (`onMove`).
 *
 * Motion: rows fade and slide up on first paint (200 ms, ease-out, staggered); a rule just moved
 * (`moved`) slides in from where it was in 200 ms. Cut under reduced motion.
 */
export function RulesList({
  label,
  rules,
  accounts,
  merchants = [],
  onOpen,
  onMove,
  openId,
  locale,
}: RulesListProps) {
  const ui = useUiMessages();
  const messages = ui.rules;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="rules-list" className="flex flex-col">
      <div
        aria-hidden="true"
        className="flex h-9 items-center gap-3 border-b text-xs font-medium text-muted-foreground"
      >
        <span className={COLUMN.if}>{messages.columns.if}</span>
        <span className={COLUMN.then}>{messages.columns.then}</span>
        <span className={COLUMN.used}>{messages.columns.used}</span>
        <span className={COLUMN.order} />
      </div>
      <ol aria-label={label} className="flex flex-col divide-y">
        {rules.map((row, index) => {
          const place = index + 1;

          const sentence = conditionsSentence(
            messages,
            row.conditions,
            { accounts, merchants },
            writtenIn,
          );

          const then = thenOf(row, messages);

          return (
            <li
              // A rule moved comes in anew, which replays its entrance, and keeps the focus on its
              // arrows, which the old row took away with it.
              key={row.moved === undefined ? row.id : `${row.id}-${row.moved.turn}`}
              ref={row.moved === undefined ? undefined : keepFocus}
              data-slot="rule-row"
              data-enabled={row.enabled}
              data-open={row.id === openId ? "" : undefined}
              className={cn(
                // Backwards only: a row waits unseen through its stagger delay, and its entrance
                // ends once drawn, rather than holding its last frame for good.
                "flex min-h-14 items-center gap-3 py-2 fill-mode-backwards duration-200 ease-out animate-in fade-in",
                row.moved?.direction === "up" && "slide-in-from-bottom-4",
                row.moved?.direction === "down" && "slide-in-from-top-4",
                row.moved === undefined && cn("slide-in-from-bottom-1", staggerDelay(index)),
              )}
            >
              <span className={COLUMN.if}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className={cn(
                    "line-clamp-2 cursor-pointer rounded-sm text-start text-sm break-words hover:underline",
                    row.enabled ? "text-foreground" : "text-muted-foreground",
                    focusRing,
                  )}
                >
                  {sentence}
                </button>
                {/* On a phone the "then" column is gone: it is said under the sentence. */}
                <span className="truncate text-xs text-muted-foreground md:hidden">{then}</span>
                {row.enabled ? null : (
                  <span className="flex">
                    <Chip>{messages.off}</Chip>
                  </span>
                )}
              </span>
              <span className={cn(COLUMN.then, "text-sm")}>
                <span
                  className={cn(
                    "min-w-0 truncate",
                    row.enabled ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {then}
                </span>
                {/* Each its own word: "archivée" agrees with a category, "archivé" with a subject. */}
                {row.categoryArchived === true ? <Chip>{messages.archived}</Chip> : null}
                {row.subjectArchived === true ? <Chip>{ui.subjects.archived}</Chip> : null}
              </span>
              <span className={cn(COLUMN.used, "text-sm text-muted-foreground")}>
                {messages.used(row.used, formatCount(row.used, writtenIn))}
              </span>
              <span className={COLUMN.order}>
                <IconButton
                  data-move=""
                  icon="moveUp"
                  size="sm"
                  label={messages.moveUp(place)}
                  disabled={index === 0}
                  onClick={() => void onMove(row.id, place - 1)}
                />
                <IconButton
                  data-move=""
                  icon="moveDown"
                  size="sm"
                  label={messages.moveDown(place)}
                  disabled={index === rules.length - 1}
                  onClick={() => void onMove(row.id, place + 1)}
                />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** `RulesList` on its way: its column titles and `rows` rows, at the same heights. */
export function RulesListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col">
        <div className="flex h-9 items-center border-b">
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex flex-col divide-y">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex min-h-14 items-center gap-3 py-2">
              <span className={COLUMN.if}>
                <Skeleton className={cn("h-3.5", row % 2 === 0 ? "w-64" : "w-48")} />
              </span>
              <span className={COLUMN.then}>
                <Skeleton className="h-3.5 w-36" />
              </span>
              <span className={COLUMN.used}>
                <Skeleton className="ms-auto h-3.5 w-14" />
              </span>
              <span className={COLUMN.order} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonFrame>
  );
}
