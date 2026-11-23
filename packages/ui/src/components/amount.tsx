import { AnimatePresence, motion } from "motion/react";
import type { Variants } from "motion/react";
import { useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { moneyParts, rollSlots } from "../lib/money";
import type { Money, RollSlot } from "../lib/money";
import { transition } from "../lib/motion";
import { cn } from "../lib/utils";
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

/** A digit comes in from below when the amount grows, from above when it shrinks. */
const digitMotion: Variants = {
  enter: (trend: number) => ({ y: trend < 0 ? "-100%" : "100%" }),
  shown: { y: "0%" },
  leave: (trend: number) => ({ y: trend < 0 ? "100%" : "-100%" }),
};

/**
 * One digit's column. Until its value first changes it is plain text, so the server's markup
 * carries no `style` attribute (the Content Security Policy forbids them); from then on each new
 * digit slides in while the old one slides out, in the same grid cell.
 */
function DigitColumn({ digit, trend }: { digit: number; trend: number }) {
  const [shown, setShown] = useState(digit);
  const [turns, setTurns] = useState(0);

  if (digit !== shown) {
    setShown(digit);
    setTurns(turns + 1);
  }

  return (
    <span data-slot="amount-digit" className="inline-grid overflow-hidden">
      <AnimatePresence initial={false} custom={trend}>
        {turns === 0 ? (
          <motion.span
            key={0}
            className="col-start-1 row-start-1"
            custom={trend}
            variants={digitMotion}
            exit="leave"
            transition={transition.base}
          >
            {digit}
          </motion.span>
        ) : (
          <motion.span
            key={turns}
            className="col-start-1 row-start-1"
            custom={trend}
            variants={digitMotion}
            initial="enter"
            animate="shown"
            exit="leave"
            transition={transition.base}
          >
            {digit}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function Rolling({ slots, trend }: { slots: Array<RollSlot>; trend: number }) {
  return slots.map((slot) =>
    slot.digit === null ? (
      <span key={slot.key}>{slot.text}</span>
    ) : (
      <DigitColumn key={slot.key} digit={slot.digit} trend={trend} />
    ),
  );
}

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
 * (ease-out), up when the amount grows, down when it shrinks. Cut under reduced motion.
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
  const [last, setLast] = useState(value.minor);
  const [trend, setTrend] = useState(0);

  if (value.minor !== last) {
    setLast(value.minor);
    setTrend(Math.sign(value.minor - last));
  }

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
        <Rolling slots={rollSlots(parts)} trend={trend} />
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
  const [last, setLast] = useState(value);
  const [trend, setTrend] = useState(0);

  if (value !== last) {
    setLast(value);
    setTrend(Math.sign(value - last));
  }

  return (
    <span data-slot="count" className="inline-flex tabular-nums">
      <span className="sr-only">{parts.map((part) => part.value).join("")}</span>
      <span aria-hidden="true" className="inline-flex">
        <Rolling slots={rollSlots(parts)} trend={trend} />
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
