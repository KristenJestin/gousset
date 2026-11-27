import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { transition } from "../lib/motion";
import { Amount, AmountSkeleton } from "./amount";
import { Button } from "./button";
import { FormMessage } from "./form-message";
import { IconButton } from "./icon-button";
import { Sheet } from "./sheet";
import { Skeleton, SkeletonFrame } from "./skeleton";
import { StatusChip } from "./status-chip";
import type { StatusTone } from "./status-chip";
import { FigureBox } from "./subject-figures";

// A subject paid back by someone else (#217; docs/data-model.md, v0.5, "Paid back"): where it
// stands, what it cost and what came back, the lines that pay it back, and those that may.

/** Where a paid-back subject stands. */
export type PaybackStateName = "paid_back" | "partly" | "asked" | "to_ask";

/** A line that pays a subject back, or may, already worded. */
export type PaybackLineView = {
  id: string;
  /** "20 Oct.". */
  day: string;
  /** The bank's label. */
  label: string;
  /** Its account's name, already worded. */
  account: string;
  /** Money in: positive. */
  amount: Money;
};

/** What the user still has to do is the only colour: a subject to ask for. */
const TONE_OF = {
  paid_back: "done",
  partly: "neutral",
  asked: "neutral",
  to_ask: "action",
} satisfies { readonly [State in PaybackStateName]: StatusTone };

/**
 * Where a paid-back subject stands, as a pill: "Paid back" (a green mark), "Partly paid back",
 * "Asked on 4 May" (or "Asked" without its day), "To ask" (violet: the user's to do).
 *
 * Motion: none of its own.
 */
export function PaybackStateChip({
  state,
  askedOn,
}: {
  state: PaybackStateName;
  /** The day it was asked, already worded ("4 May"); said with `asked` only. */
  askedOn?: string;
}) {
  const messages = useUiMessages().subjects;

  return (
    <span data-slot="payback-state" className="flex">
      <StatusChip tone={TONE_OF[state]}>
        {state === "asked" && askedOn !== undefined
          ? messages.paybackAskedDay(askedOn)
          : messages.paybackStates[state]}
      </StatusChip>
    </span>
  );
}

/** A line as its buttons name it: "VIR NORTHWIND CONSULTING, 20 Oct.". */
const named = (line: PaybackLineView) => `${line.label}, ${line.day}`;

/**
 * Lines that fold away once acted on: `act` answers false (a refusal the page says), and the line
 * comes back. Each row's end is `action`'s, for that line.
 */
function FoldingLines({
  lines,
  label,
  slot,
  emptyText,
  act,
  action,
  locale,
}: {
  lines: ReadonlyArray<PaybackLineView>;
  label: string;
  slot: string;
  emptyText: string;
  act: (id: string) => Promise<boolean>;
  action: (line: PaybackLineView, onPress: () => void) => ReactNode;
  locale: string;
}) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // The rows of the first render are drawn as they are, with no style attribute in the server's
  // markup (the Content Security Policy forbids them); only a row put back or new fades in.
  const [first] = useState(() => new Set(lines.map((line) => line.id)));
  const shown = lines.filter((line) => !gone.has(line.id));

  async function settle(id: string) {
    setGone((before) => new Set([...before, id]));

    if (!(await act(id))) {
      setGone((before) => new Set([...before].filter((each) => each !== id)));
    }
  }

  const unfolds = (id: string) =>
    first.has(id) ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  return (
    <>
      {shown.length === 0 ? (
        <p className="flex h-10 items-center text-sm text-muted-foreground">{emptyText}</p>
      ) : null}
      {/* Layout moves need Motion's `domMax` features, loaded here only. */}
      <LazyMotion features={domMax}>
        <ul aria-label={label} className="relative flex flex-col">
          {/* The row that leaves is taken out of the flow at once; the others move up by layout. */}
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((line) => (
              <m.li
                key={line.id}
                data-slot={slot}
                layout="position"
                className="border-b bg-card last:border-b-0"
                {...unfolds(line.id)}
                exit={{ opacity: 0 }}
                transition={transition.base}
              >
                <div className="flex min-h-14 items-center gap-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{line.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {line.day} · {line.account}
                    </span>
                  </div>
                  <Amount
                    value={line.amount}
                    size="sm"
                    roll={false}
                    sign="always"
                    tone="in"
                    locale={locale}
                  />
                  <span className="flex shrink-0 items-center">
                    {action(line, () => void settle(line.id))}
                  </span>
                </div>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      </LazyMotion>
    </>
  );
}

export type SubjectPaybackProps = {
  /** Who pays it back, as the user wrote it. */
  from: string;
  state: PaybackStateName;
  /** The day it was asked, already worded ("4 May"); none when not asked. */
  askedOn?: string;
  /** What it cost, all time, by the counting rule. */
  spent: Money;
  /** What its payback lines add up to. */
  paidBack: Money;
  /** Paid back less spent: positive when more came back than it cost. */
  difference: Money;
  /** Its payback lines, oldest first. */
  lines: ReadonlyArray<PaybackLineView>;
  /**
   * Detaches a payback line: it folds away at once, and comes back when it answers false (a
   * refusal the page says).
   */
  onDetach: (id: string) => Promise<boolean>;
  /** Beside where it stands: what offers the lines that may pay it back (`PaybackCandidates`). */
  find?: ReactNode;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * A paid-back subject on its page (#217): who pays it back and where it stands, then what it cost
 * ("spent", all time), what came back ("paid back") and the difference, signed either way (+€662.65
 * when more came back than it cost), then its payback lines, each to detach. `find` offers the lines
 * that may pay it back. Other currencies are not summed here: the page says them apart.
 *
 * Motion: a line detached folds away, fading out in 200 ms (ease-out) while the rows under it slide
 * up into its place (a layout move, by transform); one put back fades in. The amounts roll to their
 * new values in 200 ms (`Amount`). Cut under reduced motion.
 */
export function SubjectPayback({
  from,
  state,
  askedOn,
  spent,
  paidBack,
  difference,
  lines,
  onDetach,
  find,
  locale,
}: SubjectPaybackProps) {
  const messages = useUiMessages().subjects;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="subject-payback" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 truncate text-sm text-foreground">{messages.paybackBy(from)}</p>
        <PaybackStateChip state={state} askedOn={askedOn} />
        {find === undefined ? null : <div className="ms-auto flex">{find}</div>}
      </div>
      <div className="flex flex-wrap gap-3">
        <FigureBox label={messages.paybackSpent} slot="payback-spent">
          <Amount value={spent} size="lg" locale={writtenIn} />
        </FigureBox>
        <FigureBox label={messages.paybackPaidBack} slot="payback-paid-back">
          <Amount value={paidBack} size="lg" locale={writtenIn} />
        </FigureBox>
        <FigureBox label={messages.paybackDifference} slot="payback-difference">
          <Amount value={difference} size="lg" sign="always" locale={writtenIn} />
        </FigureBox>
      </div>
      <FoldingLines
        lines={lines}
        label={messages.paybackLines}
        slot="payback-line"
        emptyText={messages.paybackLinesNone}
        act={onDetach}
        action={(line, onPress) => (
          <IconButton
            icon="close"
            size="sm"
            label={messages.paybackDetach(named(line))}
            onClick={onPress}
          />
        )}
        locale={writtenIn}
      />
    </div>
  );
}

/** `SubjectPayback` on its way: its head, three figures and `rows` rows, at the same heights. */
export function SubjectPaybackSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-4">
        <div className="flex h-6 items-center gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex min-w-36 flex-col gap-2 rounded-lg border p-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
        <ul className="flex flex-col">
          {Array.from({ length: Math.max(1, rows) }, (_, index) => (
            <li key={index} className="border-b last:border-b-0">
              <div className="flex min-h-14 items-center gap-3 py-2">
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </span>
                <AmountSkeleton size="sm" />
                <Skeleton className="size-8" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SkeletonFrame>
  );
}

export type PaybackCandidatesProps = {
  /** Who pays it back: the lines naming them come first. */
  from: string;
  /** The lines that may pay it back, those naming the payer first, then the newest. */
  candidates: ReadonlyArray<PaybackLineView>;
  /**
   * Attaches a line as what pays it back, on the user's yes: it folds away at once, and comes back
   * when it answers false (a refusal the page says with `error`).
   */
  onAttach: (id: string) => Promise<boolean>;
  /** A refusal of the last attachment, worded by the page, said in the sheet. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * The lines that may pay a subject back (#217), behind "Find payback lines": a side sheet listing
 * them (day, account, label, amount), those naming who pays it back first. None is attached until
 * the user presses its "Attach": the yes. A refusal is said in the sheet, which stays open.
 *
 * Motion: the sheet slides in from the right in 300 ms and out in 200 ms, from the bottom on a
 * phone (`Sheet`); a line attached folds away, fading out in 200 ms (ease-out), the rows under it
 * sliding up. Cut under reduced motion.
 */
export function PaybackCandidates({
  from,
  candidates,
  onAttach,
  error,
  locale,
}: PaybackCandidatesProps) {
  const messages = useUiMessages().subjects;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <Sheet
      title={messages.paybackCandidatesTitle}
      description={messages.paybackCandidatesHelp(from)}
      trigger={
        <Button variant="secondary" size="sm" icon="search">
          {messages.paybackFind}
        </Button>
      }
    >
      <div data-slot="payback-candidates" className="flex flex-col gap-3">
        <FoldingLines
          lines={candidates}
          label={messages.paybackCandidatesTitle}
          slot="payback-candidate"
          emptyText={messages.paybackCandidatesNone}
          act={onAttach}
          action={(line, onPress) => (
            <Button
              variant="secondary"
              size="sm"
              aria-label={messages.paybackAttachOne(named(line))}
              onClick={onPress}
            >
              {messages.paybackAttach}
            </Button>
          )}
          locale={writtenIn}
        />
        <FormMessage message={error} />
      </div>
    </Sheet>
  );
}
