import { motion } from "motion/react";
import { useId } from "react";
import type { ReactNode } from "react";

import { useAnimatedPercent } from "../hooks/use-animated-percent";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatMoney, monthBarLayout } from "../lib/money";
import type { Money, MoneyRole, MonthBarLayout } from "../lib/money";
import { transition } from "../lib/motion";
import { cn } from "../lib/utils";
import { Amount, AmountSkeleton } from "./amount";
import { Lines } from "./charts/patterns/lines";
import { Icon } from "./icon";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type { MoneyRole } from "../lib/money";

export type MonthBarProps = {
  /** All that came in this month. */
  received: Money;
  spent: Money;
  /** Set aside: moved to savings or investments. */
  saved: Money;
  /** What remains: received − spent − set aside; negative when the month is overspent. */
  left: Money;
  /**
   * The part of `left` on benefit accounts (meal vouchers): yours, but restricted. Hatched at the
   * end of the part left (docs/design.md, "Hatching for money apart").
   */
  restricted?: Money;
  /** Where the money came from, in the page's words: "salary and meal vouchers". */
  note?: string;
  /**
   * The lines that may be refunds, not answered yet (#208): no income, left out of `received`, said
   * apart under it, how much and how many. Nothing is said with none.
   */
  maybeRefunds?: { count: number; amount: Money };
  /**
   * At the end of the first line, on a line of its own on a phone: a `DeltaList` that says what it
   * compares ("spending +5% vs. average"), never a bare change, which under the money received
   * would read as more income.
   */
  comparison?: ReactNode;
  /**
   * Quiet lines under the legend, one each: the month in each other currency, never converted
   * ("In USD: received $0, spent $25…").
   */
  notes?: ReadonlyArray<string>;
  /** A part was chosen (click, or Enter / Space on its button): open what it is made of. */
  onSelect?: (role: MoneyRole) => void;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/** One part of the bar: its start and width move to the new month's (SVG geometry, no reflow). */
function BarPart({ part }: { part: MonthBarLayout["parts"][number] }) {
  const width = useAnimatedPercent(part.width);

  return (
    // `x` alone would be a transform for Motion: `attrX` is the attribute.
    <motion.rect
      data-role={part.role}
      y="0"
      width={width}
      height="100%"
      initial={false}
      animate={{ attrX: `${String(part.x)}%` }}
      transition={transition.base}
      className={cn(
        "stroke-card stroke-2",
        part.role === "spent" && "fill-money-spent",
        part.role === "saved" && "fill-money-saved",
        part.role === "left" && "fill-money-left",
      )}
    />
  );
}

/** The restricted end of the part left, hatched: it moves and grows like a part. */
function Restricted({ hatch, x, width }: { hatch: string; x: number; width: number }) {
  const animatedWidth = useAnimatedPercent(width);

  return (
    <motion.rect
      data-slot="month-bar-restricted"
      y="0"
      width={animatedWidth}
      height="100%"
      fill={`url(#${hatch})`}
      initial={false}
      animate={{ attrX: `${String(x)}%` }}
      transition={transition.base}
    />
  );
}

function Bar({ layout }: { layout: MonthBarLayout }) {
  // An SVG id without React's punctuation, unique to this bar.
  const hatch = `month-bar-hatch-${useId().replaceAll(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="h-6 overflow-hidden rounded-md bg-muted">
      <svg className="block size-full" aria-hidden="true" data-slot="month-bar-drawing">
        <Lines
          id={hatch}
          width={6}
          height={6}
          strokeWidth={1.5}
          orientation={["diagonal"]}
          className="stroke-money-restricted"
        />
        {layout.parts.map((part) => (
          <BarPart key={part.role} part={part} />
        ))}
        {layout.restricted === null ? null : (
          <Restricted hatch={hatch} x={layout.restricted.x} width={layout.restricted.width} />
        )}
        {layout.receivedMark === null ? null : (
          <motion.rect
            data-slot="month-bar-received-mark"
            y="0"
            width="3"
            height="100%"
            initial={false}
            animate={{ attrX: `${String(layout.receivedMark)}%` }}
            transition={transition.base}
            className="fill-foreground"
          />
        )}
      </svg>
    </div>
  );
}

function PartContent({
  role,
  amount,
  overspent,
  restricted,
  locale,
}: {
  role: MoneyRole;
  amount: Money;
  overspent: boolean;
  /** Said under the part left, when some of it is restricted. */
  restricted: Money | null;
  locale: string | undefined;
}) {
  const messages = useUiMessages().money;
  const language = usePageLanguage();
  const over = role === "left" && overspent;
  // More came back from savings than went to them: said as such, the amount without its sign.
  const takenBack = role === "saved" && amount.minor < 0;

  const label = takenBack
    ? messages.takenFromSavings
    : restricted === null
      ? messages.roles[role]
      : messages.leftRestricted(
          formatMoney(restricted, { locale: locale ?? language, whole: true }),
        );

  // Read in this order (the amount, then its name: "€2,030 spent"). On a phone the first line
  // gives way (`contents`): its dot leads the row, its amount ends it.
  return (
    <>
      <span
        className={cn(
          "max-md:contents md:flex md:h-5 md:items-center md:gap-1.5",
          over && "text-destructive",
        )}
      >
        <span className="flex h-5 shrink-0 items-center">
          {over ? (
            <Icon name="warning" size="sm" />
          ) : (
            <span
              className={cn(
                "size-2 rounded-full",
                role === "spent" && "bg-money-spent",
                role === "saved" && "bg-money-saved",
                role === "left" && "bg-money-left",
              )}
            />
          )}
        </span>
        <span className="flex h-5 shrink-0 items-center max-md:order-last">
          <Amount
            value={over || takenBack ? { ...amount, minor: Math.abs(amount.minor) } : amount}
            whole
            size="sm"
            locale={locale}
          />
        </span>
      </span>
      <span
        data-slot="month-bar-key-name"
        className={cn(
          "max-md:flex-1 max-md:text-sm md:h-4 md:max-w-full md:truncate md:text-xs",
          over ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {over ? messages.overspent : label}
      </span>
    </>
  );
}

// A wide screen: the keys side by side. A phone, where the width does not allow it: a list, one
// row a key under a rule, the same plain rule each (the rows are square there: a rounded corner
// would bend the rule's ends).
const LEGEND_CLASSES = "flex flex-col divide-y md:flex-row md:gap-6 md:divide-y-0";

// A wide screen: the dot and the amount, the name under them. Only the last key gives way there:
// its name is the one that grows ("left, €153 restricted"), and the amounts before it are never
// cut. A phone: the dot and the name, whole, then the amount at the row's end.
const PART_CLASSES =
  "-mx-1 flex px-1 text-left md:rounded-md transition-colors duration-150 max-md:items-center max-md:gap-2 max-md:py-1.5 md:shrink-0 md:flex-col md:items-start md:last:min-w-0 md:last:shrink";

/**
 * The month in one bar (docs/wireframes, screen 1, block 1): the money received, cut into spent,
 * set aside and left, each in its role's colour, the total above and a legend under it. The
 * legend's keys (dot, amount, name) sit side by side from the bar's start rather than under their
 * parts: a part can be a sliver too narrow for its key, and when the month changes the parts move
 * while the keys stay side by side from the bar's start, their amounts rolling. On one line on a
 * wide screen, a long name cut short, so the block's height never changes. On a phone (below
 * 768 px, screen 11) the keys are a list under the bar, one row each, the name whole and the
 * amount at the row's end, and the comparison has lines of its own under the total, one a change
 * with what it is held against. Each key is
 * a button when `onSelect` is given. When more went out than came in, the bar stretches to what went out, a dark mark shows
 * where the money received ended, and the part left says by how much the month is overspent, in
 * red; the month is overspent only when `left` is below zero. Set aside below zero (taken back
 * from savings) draws no part, and its key says "taken from savings" with the amount. With
 * `restricted`, the end of the part left is hatched (benefit accounts' money) and its
 * label says how much of it. `notes` adds a quiet line each under the legend (the month in another
 * currency), cut short rather than wrapped. `maybeRefunds` adds a quiet line under what was
 * received: what may be refunds, left out of it until the user answers (#208).
 *
 * Motion: when the month changes, the parts grow or shrink to their new widths in 200 ms
 * (ease-out) and the amounts roll; cut under reduced motion. The maybe-refunds line has none of its
 * own: it comes, changes and goes with the month, at once.
 */
export function MonthBar({
  received,
  spent,
  saved,
  left,
  restricted,
  note,
  maybeRefunds,
  comparison,
  notes,
  onSelect,
  locale,
}: MonthBarProps) {
  const messages = useUiMessages().money;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const layout = monthBarLayout({ received, spent, saved, left, restricted });
  const amounts = { spent, saved, left };

  const restrictedOf = (role: MoneyRole) =>
    role === "left" && layout.restricted !== null && restricted !== undefined ? restricted : null;

  return (
    <div data-slot="month-bar" className="flex flex-col gap-2">
      <div className="flex flex-col md:flex-row md:items-center md:gap-2">
        <div className="flex h-7 min-w-0 items-center gap-2 md:flex-1">
          <span className="flex shrink-0 items-center gap-1.5 text-base font-semibold">
            <Amount value={received} whole locale={locale} />
            {messages.received}
          </span>
          {note === undefined ? null : (
            <span className="min-w-0 truncate text-sm text-muted-foreground">{note}</span>
          )}
        </div>
        {comparison === undefined ? null : (
          <span
            data-slot="month-bar-comparison"
            className="flex min-h-5 shrink-0 items-center md:ml-auto md:h-7"
          >
            {comparison}
          </span>
        )}
      </div>
      {maybeRefunds === undefined || maybeRefunds.count === 0 ? null : (
        <p
          data-slot="month-bar-maybe-refunds"
          className="-mt-2 h-4 truncate text-xs text-muted-foreground tabular-nums"
        >
          {messages.maybeRefunds(
            maybeRefunds.count,
            maybeRefunds.count.toLocaleString(writtenIn),
            formatMoney(maybeRefunds.amount, { locale: writtenIn, whole: true }),
          )}
        </p>
      )}
      <Bar layout={layout} />
      <div role="group" aria-label={messages.parts} className={LEGEND_CLASSES}>
        {layout.parts.map(({ role }) =>
          onSelect === undefined ? (
            <div key={role} data-role={role} className={PART_CLASSES}>
              <PartContent
                role={role}
                amount={amounts[role]}
                overspent={layout.overspent}
                restricted={restrictedOf(role)}
                locale={locale}
              />
            </div>
          ) : (
            <button
              key={role}
              type="button"
              data-role={role}
              className={cn(PART_CLASSES, "cursor-pointer hover:bg-muted")}
              onClick={() => onSelect(role)}
            >
              <PartContent
                role={role}
                amount={amounts[role]}
                overspent={layout.overspent}
                restricted={restrictedOf(role)}
                locale={locale}
              />
            </button>
          ),
        )}
      </div>
      {notes === undefined || notes.length === 0 ? null : (
        <ul data-slot="month-bar-notes" className="flex flex-col">
          {notes.map((line) => (
            <li key={line} className="h-4 truncate text-xs text-muted-foreground tabular-nums">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PartSkeleton() {
  return (
    <div className="flex items-center justify-between max-md:py-1.5 md:flex-col md:items-start">
      <span className="flex h-5 items-center max-md:order-last">
        <Skeleton className="h-4 w-16" />
      </span>
      <span className="flex h-5 items-center md:h-4">
        <Skeleton className="h-3 w-12" />
      </span>
    </div>
  );
}

/**
 * `MonthBar` on its way: the same lines, the same heights; on a phone, the comparison's two lines
 * (against the average, against the month before), which a month has from the user's second on,
 * and the legend's rows.
 */
export function MonthBarSkeleton() {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col">
          <div className="flex h-7 items-center gap-2">
            <AmountSkeleton />
            <Skeleton className="h-4 w-32" />
          </div>
          <span className="flex h-5 items-center md:hidden">
            <Skeleton className="h-3 w-40" />
          </span>
          <span className="flex h-5 items-center md:hidden">
            <Skeleton className="h-3 w-28" />
          </span>
        </div>
        <Skeleton className="h-6" />
        <div className={LEGEND_CLASSES}>
          <PartSkeleton />
          <PartSkeleton />
          <PartSkeleton />
        </div>
      </div>
    </SkeletonFrame>
  );
}
