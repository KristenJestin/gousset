import { motion } from "motion/react";
import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { monthBarLayout } from "../lib/money";
import type { Money, MoneyRole, MonthBarLayout } from "../lib/money";
import { transition } from "../lib/motion";
import { cn } from "../lib/utils";
import { Amount, AmountSkeleton } from "./amount";
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
  /** Where the money came from, in the page's words: "salary and meal vouchers". */
  note?: string;
  /** At the end of the first line, usually a `Delta` against the 6-month average. */
  comparison?: ReactNode;
  /** A part was chosen (click, or Enter / Space on its button): open what it is made of. */
  onSelect?: (role: MoneyRole) => void;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

function Bar({ layout }: { layout: MonthBarLayout }) {
  return (
    <div className="h-6 overflow-hidden rounded-md bg-muted">
      <svg className="block size-full" aria-hidden="true" data-slot="month-bar-drawing">
        {layout.parts.map((part) => (
          <motion.rect
            key={part.role}
            data-role={part.role}
            y="0"
            height="100%"
            initial={false}
            animate={{ attrX: `${String(part.x)}%`, width: `${String(part.width)}%` }}
            transition={transition.base}
            className={cn(
              "stroke-card stroke-2",
              part.role === "spent" && "fill-money-spent",
              part.role === "saved" && "fill-money-saved",
              part.role === "left" && "fill-money-left",
            )}
          />
        ))}
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
  locale,
}: {
  role: MoneyRole;
  amount: Money;
  overspent: boolean;
  locale: string | undefined;
}) {
  const messages = useUiMessages().money;
  const over = role === "left" && overspent;

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
        className={cn("h-4 truncate text-xs", over ? "text-destructive" : "text-muted-foreground")}
      >
        {over ? messages.overspent : messages.roles[role]}
      </span>
    </>
  );
}

const PART_CLASSES =
  "-mx-1 flex min-w-0 flex-col items-start rounded-md px-1 text-left transition-colors duration-150";

/**
 * The month in one bar (docs/wireframes, screen 1, block 1): the money received, cut into spent,
 * set aside and left, each in its role's colour, with its amount under it and the total above.
 * Each part is a button when `onSelect` is given. When more went out than came in, the bar
 * stretches to what went out, a dark mark shows where the money received ended, and the part
 * left says by how much the month is overspent, in red.
 *
 * Motion: when the month changes, the parts grow or shrink to their new widths in 200 ms
 * (ease-out) and the amounts roll; cut under reduced motion.
 */
export function MonthBar({
  received,
  spent,
  saved,
  left,
  note,
  comparison,
  onSelect,
  locale,
}: MonthBarProps) {
  const messages = useUiMessages().money;
  const layout = monthBarLayout({ received, spent, saved, left });
  const amounts = { spent, saved, left };

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
      <div role="group" aria-label={messages.parts} className="grid grid-cols-3 gap-2">
        {layout.parts.map(({ role }) =>
          onSelect === undefined ? (
            <div key={role} data-role={role} className={PART_CLASSES}>
              <PartContent
                role={role}
                amount={amounts[role]}
                overspent={layout.overspent}
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
        <div className="grid grid-cols-3 gap-2">
          <PartSkeleton />
          <PartSkeleton />
          <PartSkeleton />
        </div>
      </div>
    </SkeletonFrame>
  );
}
