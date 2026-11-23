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
  /** At the end of the first line, usually a `Delta` against the 6-month average. */
  comparison?: ReactNode;
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

  const label =
    restricted === null
      ? messages.roles[role]
      : messages.leftRestricted(
          formatMoney(restricted, { locale: locale ?? language, whole: true }),
        );

  return (
    <>
      <span className={cn("flex h-5 items-center gap-1.5", over && "text-destructive")}>
        {over ? (
          <Icon name="warning" size="sm" />
        ) : (
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              role === "spent" && "bg-money-spent",
              role === "saved" && "bg-money-saved",
              role === "left" && "bg-money-left",
            )}
          />
        )}
        <Amount
          value={over ? { ...amount, minor: Math.abs(amount.minor) } : amount}
          whole
          size="sm"
          locale={locale}
        />
      </span>
      <span
        className={cn(
          "h-4 max-w-full truncate text-xs",
          over ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {over ? messages.overspent : label}
      </span>
    </>
  );
}

// Tighter on a phone, where the block leaves the legend about 250 px.
const LEGEND_CLASSES = "flex gap-4 sm:gap-6";

// Only the last key gives way on a narrow screen: its name is the one that grows ("left, €153
// restricted"), and the amounts before it are never cut.
const PART_CLASSES =
  "-mx-1 flex shrink-0 flex-col items-start rounded-md px-1 text-left transition-colors duration-150 last:min-w-0 last:shrink";

/**
 * The month in one bar (docs/wireframes, screen 1, block 1): the money received, cut into spent,
 * set aside and left, each in its role's colour, the total above and a legend under it. The
 * legend's keys (dot, amount, name) sit side by side from the bar's start rather than under their
 * parts: a part can be a sliver too narrow for its key, and when the month changes the parts move
 * while the keys stay side by side from the bar's start, their amounts rolling. On one line on every width, a long
 * name cut short, so the block's height never changes. Each key is a button when `onSelect` is
 * given. When more went out than came in, the bar stretches to what went out, a dark mark shows
 * where the money received ended, and the part left says by how much the month is overspent, in
 * red. With `restricted`, the end of the part left is hatched (benefit accounts' money) and its
 * label says how much of it.
 *
 * Motion: when the month changes, the parts grow or shrink to their new widths in 200 ms
 * (ease-out) and the amounts roll; cut under reduced motion.
 */
export function MonthBar({
  received,
  spent,
  saved,
  left,
  restricted,
  note,
  comparison,
  onSelect,
  locale,
}: MonthBarProps) {
  const messages = useUiMessages().money;
  const layout = monthBarLayout({ received, spent, saved, left, restricted });
  const amounts = { spent, saved, left };

  const restrictedOf = (role: MoneyRole) =>
    role === "left" && layout.restricted !== null && restricted !== undefined ? restricted : null;

  return (
    <div data-slot="month-bar" className="flex flex-col gap-2">
      <div className="flex h-7 min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-base font-semibold">
          <Amount value={received} whole locale={locale} />
          {messages.received}
        </span>
        {note === undefined ? null : (
          <span className="min-w-0 truncate text-sm text-muted-foreground">{note}</span>
        )}
        {comparison === undefined ? null : <span className="ml-auto shrink-0">{comparison}</span>}
      </div>
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
    </div>
  );
}

function PartSkeleton() {
  return (
    <div className="flex flex-col">
      <span className="flex h-5 items-center">
        <Skeleton className="h-4 w-16" />
      </span>
      <span className="flex h-4 items-center">
        <Skeleton className="h-3 w-12" />
      </span>
    </div>
  );
}

/** `MonthBar` on its way: the same three lines, the same heights. */
export function MonthBarSkeleton() {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-2">
        <div className="flex h-7 items-center gap-2">
          <AmountSkeleton />
          <Skeleton className="h-4 w-32" />
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
