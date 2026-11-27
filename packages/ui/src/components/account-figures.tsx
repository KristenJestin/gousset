import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import type { Money } from "../lib/money";
import { Amount } from "./amount";
import { Chip } from "./chip";
import { RestrictedAmount } from "./restricted-amount";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** One headline figure under its label, in a box of its own: a row of them wraps on a phone. */
export function FigureBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export type AccountFiguresProps = {
  /** The day the balance is as of, already worded ("31 Oct."). */
  balanceDay: string;
  balance: Money;
  /** The period `in` and `out` cover, already worded ("October"). */
  period: string;
  in: Money;
  out: Money;
  institution?: string;
  /** The group's words, already translated ("Available"). */
  groupLabel?: string;
  /** A benefit account's: its balance is hatched, restricted money (docs/design.md). */
  restricted?: boolean;
};

/**
 * An account page's header figures (docs/wireframes, screen 7): its institution and group as
 * chips, then its balance on a day, what came in and what went out over a period. With
 * `restricted` (a benefit account), the balance sits on a hatched chip.
 */
export function AccountFigures({
  balanceDay,
  balance,
  period,
  in: amountIn,
  out,
  institution,
  groupLabel,
  restricted = false,
}: AccountFiguresProps) {
  const messages = useUiMessages().accounts;
  const locale = usePageLanguage();
  const hasChips = institution !== undefined || groupLabel !== undefined;

  return (
    <div className="flex flex-col gap-3">
      {hasChips ? (
        <div className="flex flex-wrap gap-2">
          {institution === undefined ? null : <Chip>{institution}</Chip>}
          {groupLabel === undefined ? null : <Chip>{groupLabel}</Chip>}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <FigureBox label={messages.balanceOnDay(balanceDay)}>
          {restricted ? (
            <span className="flex">
              <RestrictedAmount value={balance} size="lg" whole={false} locale={locale} roll />
            </span>
          ) : (
            <Amount value={balance} size="lg" locale={locale} />
          )}
        </FigureBox>
        <FigureBox label={messages.inPeriod(period)}>
          <Amount value={amountIn} size="lg" locale={locale} />
        </FigureBox>
        <FigureBox label={messages.outPeriod(period)}>
          <Amount value={out} size="lg" locale={locale} />
        </FigureBox>
      </div>
    </div>
  );
}

/** `AccountFigures` on its way: the chips' place and the three figures, at the same heights. */
export function AccountFiguresSkeleton() {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex w-32 flex-col gap-2 rounded-lg border p-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonFrame>
  );
}
