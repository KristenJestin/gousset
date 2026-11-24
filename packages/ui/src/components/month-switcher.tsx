import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { addMonths, formatMonth, monthIndex, monthOf } from "../lib/month";
import type { YearMonth } from "../lib/month";
import { transition } from "../lib/motion";
import { IconButton } from "./icon-button";

export type { YearMonth } from "../lib/month";

export type MonthSwitcherProps = {
  /** The month on screen; `month` from 1 (January) to 12. */
  value: YearMonth;
  onChange: (month: YearMonth) => void;
  /** The last month it may reach: the current month by default, since the future has no lines. */
  latest?: YearMonth;
  /** The first month it may reach; none by default, the past being open. */
  earliest?: YearMonth;
  /** Its name for assistive technologies: "Month" by default; another when a page has two. */
  label?: string;
};

// The label slides in from the side the month comes from, and the old one out the other way.
const slide = {
  enter: (direction: number) => ({ x: `${direction * 40}%`, opacity: 0 }),
  center: { x: "0%", opacity: 1 },
  exit: (direction: number) => ({ x: `${direction * -40}%`, opacity: 0 }),
};

/**
 * ‹ October 2026 ›: the month on screen, with the previous and next months a press away. The
 * month is written in the page's language (`<html lang>`). Next is disabled on the latest month,
 * Previous on the earliest one when it is given.
 * With the focus on either button, the Left and Right arrows move too.
 *
 * Motion: the label slides out and the new one slides in from the side it comes from, 200 ms,
 * easing out; cut under reduced motion.
 */
export function MonthSwitcher({
  value,
  onChange,
  latest,
  earliest,
  label: name,
}: MonthSwitcherProps) {
  const messages = useUiMessages();
  const language = usePageLanguage();
  const index = monthIndex(value);
  const [shownIndex, setShownIndex] = useState(index);
  const [direction, setDirection] = useState(1);
  // False on the server and while hydrating, true after: until then the label has no `animate`,
  // so the server's markup carries no `style` attribute (the Content Security Policy forbids
  // them). Once given, its exit plays as Motion's (and is skipped under reduced motion).
  const hydrated = useHydrated();
  // Read once, when it mounts: a page left open past midnight on the 1st keeps its bound. Only
  // the browser's reading counts: the server's clock and timezone may name another month, and
  // hydration would keep the server's `disabled` on Next.
  const [current] = useState(() => monthOf(new Date()));
  const bound = latest ?? (hydrated ? current : undefined);

  // Which way the month moved decides which way the label slides.
  if (index !== shownIndex) {
    setDirection(index > shownIndex ? 1 : -1);
    setShownIndex(index);
  }

  // Until the bound is known (on the server, without `latest`), Next leads nowhere.
  const canGoNext = bound !== undefined && index < monthIndex(bound);
  const canGoBack = earliest === undefined || index > monthIndex(earliest);
  const label = formatMonth(value, language);

  const step = (steps: number) => {
    if (steps < 0 ? canGoBack : canGoNext) {
      onChange(addMonths(value, steps));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <div
      role="group"
      aria-label={name ?? messages.pieces.month}
      data-slot="month-switcher"
      className="inline-flex items-center gap-1"
      onKeyDown={onKeyDown}
    >
      <IconButton
        icon="previous"
        label={messages.pieces.previousMonth}
        disabled={!canGoBack}
        focusableWhenDisabled
        onClick={() => step(-1)}
      />
      {/* Said once per change; the sliding labels, old and new, are only drawn. */}
      <span aria-live="polite" className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className="relative grid min-w-36 place-items-center overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.span
            key={index}
            custom={direction}
            variants={slide}
            initial={hydrated ? "enter" : undefined}
            animate={hydrated ? "center" : undefined}
            exit="exit"
            transition={transition.base}
            data-slot="month-label"
            className="block px-2 text-sm font-medium whitespace-nowrap text-foreground tabular-nums first-letter:uppercase"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
      <IconButton
        icon="next"
        label={messages.pieces.nextMonth}
        disabled={!canGoNext}
        // It turns disabled under the user's focus on the latest month: the focus stays on it,
        // and the arrows keep working.
        focusableWhenDisabled
        onClick={() => step(1)}
      />
    </div>
  );
}
