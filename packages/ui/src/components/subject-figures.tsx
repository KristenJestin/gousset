import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatMoney } from "../lib/money";
import type { Money } from "../lib/money";
import { Amount } from "./amount";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** One list formatter per language, built once: building one is slow. */
const listFormats = new Map<string, Intl.ListFormat>();

function listFormat(locale: string): Intl.ListFormat {
  const known = listFormats.get(locale) ?? new Intl.ListFormat(locale, { type: "conjunction" });

  listFormats.set(locale, known);

  return known;
}

function FigureBox({
  label,
  slot,
  children,
}: {
  label: string;
  slot: string;
  children: ReactNode;
}) {
  return (
    <div data-slot={slot} className="flex min-w-36 flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export type SubjectFiguresProps = {
  /** What the cost covers, already worded: "cost in 2026", "cost, all time". */
  costLabel: string;
  /** What it and what is inside it cost in the period, each expense once, in the user's currency. */
  cost: Money;
  /** The same in other currencies, never converted: said apart, under the cost. */
  elsewhere?: ReadonlyArray<Money>;
  /** Its cost per month over the period's months; none without an expense. */
  perMonth: Money | null;
  /**
   * A subject that has a value: its estimated value (none when not given) and its loan with what
   * is still owed (none without). Left out for a subject without a value: neither is shown.
   */
  asset?: {
    value: Money | null;
    loan: { name: string; balance: Money } | null;
  };
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * A subject's figures (docs/wireframes, screen 5, block 2): its cost in the period and per month,
 * and for a subject with a value its estimated value and its loan's balance. Other currencies are
 * said apart, never converted.
 *
 * Motion: when the period changes, every amount rolls to its new value in 200 ms, ease-out
 * (`Amount`), as the review's do when the month changes. Cut under reduced motion.
 */
export function SubjectFigures({
  costLabel,
  cost,
  elsewhere = [],
  perMonth,
  asset,
  locale,
}: SubjectFiguresProps) {
  const messages = useUiMessages().subjects;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="subject-figures" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <FigureBox label={costLabel} slot="subject-cost">
          <Amount value={cost} size="lg" whole locale={writtenIn} />
        </FigureBox>
        <FigureBox label={messages.perMonth} slot="subject-per-month">
          {perMonth === null ? (
            <span className="flex h-9 items-center text-sm text-muted-foreground">
              {messages.noExpense}
            </span>
          ) : (
            <Amount value={perMonth} size="lg" whole locale={writtenIn} />
          )}
        </FigureBox>
        {asset === undefined ? null : (
          <>
            <FigureBox label={messages.value} slot="subject-value">
              {asset.value === null ? (
                <span className="flex h-9 items-center text-sm text-muted-foreground">
                  {messages.loanNone}
                </span>
              ) : (
                <Amount value={asset.value} size="lg" whole locale={writtenIn} />
              )}
            </FigureBox>
            <FigureBox label={messages.loan} slot="subject-loan">
              {asset.loan === null ? (
                <span className="flex h-9 items-center text-sm text-muted-foreground">
                  {messages.loanNone}
                </span>
              ) : (
                <>
                  <Amount value={asset.loan.balance} size="lg" whole locale={writtenIn} />
                  <span className="truncate text-xs text-muted-foreground">
                    {messages.loanOwed(asset.loan.name)}
                  </span>
                </>
              )}
            </FigureBox>
          </>
        )}
      </div>
      {elsewhere.length === 0 ? null : (
        <p data-slot="subject-elsewhere" className="text-xs text-muted-foreground">
          {messages.elsewhere(
            listFormat(writtenIn).format(
              elsewhere.map((amount) => formatMoney(amount, { locale: writtenIn })),
            ),
          )}
        </p>
      )}
    </div>
  );
}

/** `SubjectFigures` on its way: two figures, or four with `asset`, at the same heights. */
export function SubjectFiguresSkeleton({ asset = false }: { asset?: boolean }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: asset ? 4 : 2 }, (_, index) => (
          <div key={index} className="flex min-w-36 flex-col gap-2 rounded-lg border p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}
