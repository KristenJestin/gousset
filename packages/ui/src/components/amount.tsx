import { usePageLanguage } from "../hooks/use-page-language";
import { useTrend } from "../hooks/use-trend";
import { moneyParts, rollSlots } from "../lib/money";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { RollingDigits } from "./rolling-digits";
import { Skeleton } from "./skeleton";

export type AmountSize = "sm" | "md" | "lg";

export type AmountTone = "neutral" | "spent" | "saved" | "left" | "income";

export type AmountProps = {
  /** Integer minor units and a currency: `{ minor: 312000, currency: "EUR" }`. */
  value: Money;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
  /** `always` writes a plus on positives (a refund, a change); negatives always have a minus. */
  sign?: "auto" | "always";
  /** Whole units, for summaries: `€3,120`. */
  whole?: boolean;
  /** `sm` in rows, `md` in text, `lg` for a block's headline figure. */
  size?: AmountSize;
  /** A money role's colour, only where the design gives the figure that role. */
  tone?: AmountTone;
  /** The digits roll to the next value when it changes. Off for long static lists. */
  roll?: boolean;
};

function amountClasses(size: AmountSize, tone: AmountTone) {
  return cn(
    "inline-flex whitespace-pre tabular-nums",
    size === "sm" && "text-sm font-medium",
    size === "md" && "text-base font-medium",
    size === "lg" && "text-3xl font-semibold tracking-tight",
    tone === "spent" && "text-money-spent",
    tone === "saved" && "text-money-saved",
    tone === "left" && "text-money-left",
    tone === "income" && "text-money-income",
  );
}

/**
 * An amount of money: its sign (a true minus, a plus when asked), its currency and the locale's
 * separators, in tabular figures so amounts line up.
 *
 * Motion: when the value changes, each digit that changes rolls to its new one in 200 ms
 * (ease-out), up when the amount grows, down when it shrinks (`RollingDigits`). Cut under reduced
 * motion.
 */
export function Amount({
  value,
  locale,
  sign = "auto",
  whole = false,
  size = "md",
  tone = "neutral",
  roll = true,
}: AmountProps) {
  const pageLocale = usePageLanguage();
  const parts = moneyParts(value, { locale: locale ?? pageLocale, sign, whole });
  const text = parts.map((part) => part.value).join("");
  const trend = useTrend(value.minor);

  if (!roll) {
    return (
      <span data-slot="amount" className={amountClasses(size, tone)}>
        {text}
      </span>
    );
  }

  return (
    <span data-slot="amount" className={amountClasses(size, tone)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        <RollingDigits slots={rollSlots(parts)} trend={trend} />
      </span>
    </span>
  );
}

const countFormats = new Map<string, Intl.NumberFormat>();

function countFormat(locale: string) {
  const known = countFormats.get(locale) ?? new Intl.NumberFormat(locale);

  countFormats.set(locale, known);

  return known;
}

/**
 * A count (lines to review, flags) whose digits roll as `Amount`'s do: down when it drops, up
 * when it grows. Tabular figures; the page's language for the separators.
 *
 * Motion: each changing digit rolls to its new one in 200 ms (ease-out); cut under reduced motion.
 */
export function Count({ value, locale }: { value: number; locale?: string }) {
  const pageLocale = usePageLanguage();
  const parts = countFormat(locale ?? pageLocale).formatToParts(value);
  const trend = useTrend(value);

  return (
    <span data-slot="count" className="inline-flex tabular-nums">
      <span className="sr-only">{parts.map((part) => part.value).join("")}</span>
      <span aria-hidden="true" className="inline-flex">
        <RollingDigits slots={rollSlots(parts)} trend={trend} />
      </span>
    </span>
  );
}

/** An amount on its way: the same height as `Amount` of that size, for a block's skeleton. */
export function AmountSkeleton({ size = "md" }: { size?: AmountSize }) {
  return (
    <Skeleton
      className={cn(
        "inline-block align-bottom",
        size === "sm" && "h-5 w-14",
        size === "md" && "h-6 w-20",
        size === "lg" && "h-9 w-36",
      )}
    />
  );
}
