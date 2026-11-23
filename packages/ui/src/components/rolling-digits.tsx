import { AnimatePresence, motion } from "motion/react";
import type { Variants } from "motion/react";
import { useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useTrend } from "../hooks/use-trend";
import { countParts } from "../lib/count";
import { rollSlots } from "../lib/money";
import type { RollSlot } from "../lib/money";
import { transition } from "../lib/motion";

// The digits' roll that `Amount` and `RollingCount` share: one column per digit, which rolls to
// its new digit when the value changes. No style element is injected (unlike NumberFlow, whose
// `<style>` a strict Content Security Policy blocks).

/** A digit comes in from below when the value grows, from above when it shrinks. */
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
    <span data-slot="rolling-digit" className="inline-grid overflow-hidden">
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

/**
 * Formatted parts (`rollSlots`) as rolling digits: each digit in its column, the rest as text.
 * `trend` is the sign of the last change, which sets the direction of the roll. Hidden from
 * screen readers by its caller, which says the whole value once.
 */
export function RollingDigits({ slots, trend }: { slots: Array<RollSlot>; trend: number }) {
  return slots.map((slot) =>
    slot.digit === null ? (
      <span key={slot.key}>{slot.text}</span>
    ) : (
      <DigitColumn key={slot.key} digit={slot.digit} trend={trend} />
    ),
  );
}

export type RollingCountProps = {
  /** A whole count: lines read, lines added. */
  value: number;
  /** The page's language (`<html lang>`) unless given: it writes the separators. */
  locale?: string;
};

/**
 * A count in the locale's figures (`1,204`, `1 204` in French), tabular, whose digits roll to
 * the next value as `Amount`'s do: 200 ms, ease-out, up when it grows, down when it shrinks.
 * Cut under reduced motion. Screen readers hear the whole number, never a digit on its way.
 */
export function RollingCount({ value, locale }: RollingCountProps) {
  const pageLocale = usePageLanguage();
  const parts = countParts(value, locale ?? pageLocale);
  const text = parts.map((part) => part.value).join("");
  const trend = useTrend(value);

  return (
    <span data-slot="rolling-count" className="inline-flex whitespace-pre tabular-nums">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        <RollingDigits slots={rollSlots(parts)} trend={trend} />
      </span>
    </span>
  );
}
