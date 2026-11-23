import { motion } from "motion/react";
import { useId } from "react";

import { useAnimatedPercent } from "../hooks/use-animated-percent";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatMoney } from "../lib/money";
import type { Money } from "../lib/money";
import { staggerDelay } from "../lib/stagger";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Button } from "./button";
import { Chip } from "./chip";
import { Lines } from "./charts/patterns/lines";
import { Icon } from "./icon";
import { RestrictedAmount } from "./restricted-amount";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** What expires on one day, already worded ("31 Dec."). */
export type BenefitExpiring = {
  day: string;
  amount: Money;
  /** Past its day: still counted in the balance, until the issuer takes it back. */
  expired: boolean;
};

/** A credit with something left on it, in the order the issuer uses them. */
export type BenefitCredit = {
  id: string;
  /** The day it was credited, already worded ("3 Oct."); `null` for the opening balance. */
  day: string | null;
  /** Its label ("MEALCARD CREDIT"); for the opening balance, the page's words. */
  label: string;
  /** What was credited. */
  amount: Money;
  /** What is left of it. */
  left: Money;
  /** Its expiry day, already worded ("31 Dec."); `null` when it does not expire. */
  expires: string | null;
  /** Its expiry day is past: still counted in the balance, until the issuer takes it back. */
  expired: boolean;
};

export type BenefitCreditsProps = {
  /** The order of use, already worded ("Oldest first"). */
  order: string;
  /** Each day something expires, and how much, soonest first. */
  expiring: ReadonlyArray<BenefitExpiring>;
  /** The credits with something left, in order of use. */
  credits: ReadonlyArray<BenefitCredit>;
  /** Spent beyond what the credits held: a warning line. */
  uncovered?: Money;
  /** Opens a credit's expiry date: a button on each credit but the opening balance. */
  onEditExpiry?: (id: string) => void;
};

/** How much of `amount` is left, in percent of the bar (0 to 100). */
function leftPercent(left: Money, amount: Money) {
  if (amount.minor <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (left.minor / amount.minor) * 100));
}

/**
 * What is left of a credit, as a thin hatched bar over the whole credit. The width is an SVG
 * attribute that Motion writes: no style attribute, no reflow.
 */
function CreditBar({ left, amount }: { left: Money; amount: Money }) {
  // An SVG id without React's punctuation, unique to this bar.
  const hatch = `benefit-credit-hatch-${useId().replaceAll(/[^a-zA-Z0-9]/g, "")}`;
  const width = useAnimatedPercent(leftPercent(left, amount));

  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <svg className="block size-full" aria-hidden="true">
        <Lines
          id={hatch}
          width={6}
          height={6}
          strokeWidth={1.5}
          orientation={["diagonal"]}
          className="stroke-money-restricted"
        />
        <motion.rect
          data-slot="benefit-credit-bar"
          x="0"
          y="0"
          width={width}
          height="100%"
          className="fill-money-restricted/15"
        />
        <motion.rect x="0" y="0" width={width} height="100%" fill={`url(#${hatch})`} />
      </svg>
    </div>
  );
}

function CreditRow({
  credit,
  index,
  onEditExpiry,
}: {
  credit: BenefitCredit;
  index: number;
  onEditExpiry: ((id: string) => void) | undefined;
}) {
  const messages = useUiMessages().accounts;
  const locale = usePageLanguage();

  return (
    <li
      data-slot="benefit-credit"
      className={cn(
        "flex h-16 flex-col justify-center gap-1.5 animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200",
        staggerDelay(index),
      )}
    >
      <div className="flex h-8 items-center gap-3 text-sm">
        <span className="w-14 shrink-0 text-muted-foreground">{credit.day}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">{credit.label}</span>
          {credit.expires === null ? null : (
            <Chip>
              {credit.expired
                ? messages.creditsExpiredOn(credit.expires)
                : messages.creditsExpires(credit.expires)}
            </Chip>
          )}
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <Amount value={credit.left} size="sm" locale={locale} />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {messages.creditsOf(formatMoney(credit.amount, { locale }))}
          </span>
        </span>
        {onEditExpiry === undefined || credit.day === null ? null : (
          <Button
            variant="secondary"
            size="sm"
            icon="calendar"
            aria-label={messages.creditsEditExpiryOf(credit.label)}
            onClick={() => onEditExpiry(credit.id)}
          >
            {messages.creditsEditExpiry}
          </Button>
        )}
      </div>
      <CreditBar left={credit.left} amount={credit.amount} />
    </li>
  );
}

const HEADING_CLASSES = "flex h-5 items-center text-sm font-semibold";

/**
 * A benefit account's credits (docs/vision.md, "Benefit accounts"): the order its issuer uses
 * them in, what spending went beyond them, what expires when (hatched, an expired amount still
 * counted until the issuer takes it back), then each credit with something left, in order of use:
 * its day, label, expiry, what is left of it and a thin hatched bar of left over credited.
 * `onEditExpiry` adds an "Expiry date" button to every credit but the opening balance.
 *
 * Motion: rows fade and slide up on first paint (200 ms, staggered); when what is left of a credit
 * changes, its bar grows or shrinks to its new width in 200 ms (ease-out). Everything is cut under
 * reduced motion.
 */
export function BenefitCredits({
  order,
  expiring,
  credits,
  uncovered,
  onEditExpiry,
}: BenefitCreditsProps) {
  const messages = useUiMessages().accounts;
  const locale = usePageLanguage();

  return (
    <div data-slot="benefit-credits" className="flex flex-col gap-4">
      <div className="flex h-5 items-center gap-2 text-sm">
        <span className="text-muted-foreground">{messages.settingsCreditOrder}</span>
        <span className="truncate font-medium">{order}</span>
      </div>
      {uncovered === undefined ? null : (
        <p className="flex h-5 items-center gap-1.5 text-sm text-destructive">
          <Icon name="warning" size="sm" />
          {messages.creditsUncovered(formatMoney(uncovered, { locale }))}
        </p>
      )}
      {credits.length === 0 ? (
        <p className="flex h-10 items-center text-sm text-muted-foreground">
          {messages.creditsEmpty}
        </p>
      ) : (
        <>
          {expiring.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h3 className={HEADING_CLASSES}>{messages.creditsExpiring}</h3>
              <ul className="flex flex-col divide-y">
                {expiring.map((entry, index) => (
                  <li
                    key={entry.day}
                    data-slot="benefit-expiring"
                    className={cn(
                      "flex h-8 items-center justify-between gap-3 text-sm animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200",
                      staggerDelay(index),
                    )}
                  >
                    <span className={cn("truncate", !entry.expired && "text-muted-foreground")}>
                      {entry.expired ? messages.creditsExpiredOn(entry.day) : entry.day}
                    </span>
                    <RestrictedAmount value={entry.amount} size="sm" locale={locale} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="flex flex-col gap-2">
            <h3 className={HEADING_CLASSES}>{messages.creditsTitle}</h3>
            <ul className="flex flex-col divide-y">
              {credits.map((credit, index) => (
                <CreditRow
                  key={credit.id}
                  credit={credit}
                  index={index}
                  onEditExpiry={onEditExpiry}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * `BenefitCredits` on its way: the order's line, `expiring` days and `credits` credits, at the
 * same heights as the loaded block.
 */
export function BenefitCreditsSkeleton({
  expiring = 2,
  credits = 2,
}: {
  expiring?: number;
  credits?: number;
}) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-4">
        <div className="flex h-5 items-center gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="flex flex-col divide-y">
            {Array.from({ length: expiring }, (_, row) => (
              <div key={row} className="flex h-8 items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="flex flex-col divide-y">
            {Array.from({ length: credits }, (_, row) => (
              <div key={row} className="flex h-16 flex-col justify-center gap-1.5">
                <div className="flex h-8 items-center gap-3">
                  <Skeleton className="h-3.5 w-10 shrink-0" />
                  <Skeleton className="h-3.5 min-w-0 flex-1" />
                  <Skeleton className="h-3.5 w-16 shrink-0" />
                </div>
                <Skeleton className="h-2 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonFrame>
  );
}
