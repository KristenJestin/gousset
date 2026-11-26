import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import { useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { transition } from "../lib/motion";
import { Amount, AmountSkeleton, Count } from "./amount";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { IconButton } from "./icon-button";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** An expense of a dated subject's period, proposed for it, not attached yet. */
export type SubjectProposal = {
  id: string;
  /** The day it happened, already worded: "12 Jul.". */
  day: string;
  /** Who was paid, else the bank's label. */
  title: string;
  /** Its category, already worded. */
  category: string;
  /** What it cost. */
  amount: Money;
};

export type SubjectProposalsProps = {
  proposals: ReadonlyArray<SubjectProposal>;
  /** How many more the period has beyond those listed. */
  more?: number;
  /** What the list is, for screen readers ("Expenses to confirm for Alps 2028"). */
  label: string;
  /**
   * Attaches these expenses to the subject: confirming them. The rows fold away at once and come
   * back when it answers false (a refusal the page says).
   */
  onAttach: (ids: ReadonlyArray<string>) => Promise<boolean>;
  /** Declines them ("Not for this subject"), for good: folded away as `onAttach` does. */
  onDecline: (ids: ReadonlyArray<string>) => Promise<boolean>;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/** A proposal as its buttons name it: "Fuelstop, 3 Jul.". */
const named = (proposal: SubjectProposal) => `${proposal.title}, ${proposal.day}`;

/**
 * What a dated subject proposes (#37, the maintainer's decision): the expenses of its period not
 * attached yet, each confirmed by the user, never attached unasked. Nothing is selected at first.
 * Each row attaches its expense or declines it ("Not for this subject", remembered); a selection is
 * attached or declined at once, or every row with "Attach all". How many are left rolls as it goes
 * down.
 *
 * Motion: an expense attached or declined folds away, fading out in 200 ms (ease-out) while the
 * rows under it slide up into its place (a layout move, by transform); the count's digits roll.
 * One put back fades in. Cut under reduced motion.
 */
export function SubjectProposals({
  proposals,
  more = 0,
  label,
  onAttach,
  onDecline,
  locale,
}: SubjectProposalsProps) {
  const messages = useUiMessages();
  const subjects = messages.subjects;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // The rows of the first render are drawn as they are, with no style attribute in the server's
  // markup (the Content Security Policy forbids them); only a row put back fades in.
  const [first] = useState(() => new Set(proposals.map((proposal) => proposal.id)));
  const shown = proposals.filter((proposal) => !gone.has(proposal.id));
  const chosen = shown.filter((proposal) => selected.has(proposal.id)).map(({ id }) => id);
  const allChosen = shown.length > 0 && chosen.length === shown.length;

  async function settle(ids: ReadonlyArray<string>, action: typeof onAttach) {
    const settled = new Set(ids);

    setGone((before) => new Set([...before, ...ids]));
    setSelected((before) => new Set([...before].filter((id) => !settled.has(id))));

    if (!(await action(ids))) {
      setGone((before) => new Set([...before].filter((id) => !settled.has(id))));
    }
  }

  const unfolds = (id: string) =>
    first.has(id) ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  return (
    <div data-slot="subject-proposals" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="flex items-baseline gap-1.5 text-sm font-medium" data-slot="proposals-count">
          <Count value={shown.length + more} locale={writtenIn} />
          <span>{subjects.toConfirm}</span>
        </p>
        <p className="text-xs text-muted-foreground">{subjects.proposalsHelp}</p>
      </div>
      {shown.length === 0 ? (
        <p className="flex h-10 items-center text-sm text-muted-foreground">
          {subjects.proposalsNone}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
          <Checkbox
            label={subjects.selectAll}
            checked={allChosen}
            onCheckedChange={(checked) =>
              setSelected(new Set(checked ? shown.map(({ id }) => id) : []))
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={chosen.length === 0}
              onClick={() => void settle(chosen, onDecline)}
            >
              {subjects.declineSelected}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={chosen.length === 0}
              onClick={() => void settle(chosen, onAttach)}
            >
              {subjects.attachSelected}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void settle(
                  shown.map(({ id }) => id),
                  onAttach,
                )
              }
            >
              {subjects.attachAll}
            </Button>
          </div>
        </div>
      )}
      {/* Layout moves need Motion's `domMax` features, loaded here only. */}
      <LazyMotion features={domMax}>
        <ul aria-label={label} className="relative flex flex-col">
          {/* The row that leaves is taken out of the flow at once; the others move up by layout. */}
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((proposal) => (
              <m.li
                key={proposal.id}
                data-slot="subject-proposal"
                layout="position"
                className="border-b bg-card last:border-b-0"
                {...unfolds(proposal.id)}
                exit={{ opacity: 0 }}
                transition={transition.base}
              >
                <div className="flex h-14 items-center gap-3">
                  <Checkbox
                    label={subjects.selectOne(named(proposal))}
                    hideLabel
                    checked={selected.has(proposal.id)}
                    onCheckedChange={(checked) =>
                      setSelected((before) =>
                        checked
                          ? new Set([...before, proposal.id])
                          : new Set([...before].filter((id) => id !== proposal.id)),
                      )
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{proposal.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {proposal.day} · {proposal.category}
                    </span>
                  </div>
                  <Amount value={proposal.amount} size="sm" roll={false} locale={writtenIn} />
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      icon="check"
                      size="sm"
                      label={subjects.attachOne(named(proposal))}
                      onClick={() => void settle([proposal.id], onAttach)}
                    />
                    <IconButton
                      icon="close"
                      size="sm"
                      label={subjects.declineOne(named(proposal))}
                      onClick={() => void settle([proposal.id], onDecline)}
                    />
                  </span>
                </div>
              </m.li>
            ))}
          </AnimatePresence>
          {more > 0 && shown.length > 0 ? (
            <li className="flex h-10 items-center text-sm text-muted-foreground">
              {messages.money.moreRows(more)}
            </li>
          ) : null}
        </ul>
      </LazyMotion>
    </div>
  );
}

/** `SubjectProposals` on its way: its count, its toolbar and `rows` rows of the same height. */
export function SubjectProposalsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex h-11 items-center justify-between border-b pb-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-40" />
        </div>
        <ul className="flex flex-col">
          {Array.from({ length: rows }, (_, index) => (
            <li key={index} className="border-b last:border-b-0">
              <div className="flex h-14 items-center gap-3">
                <Skeleton className="size-4" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-36" />
                </span>
                <AmountSkeleton size="sm" />
                <Skeleton className="h-8 w-16" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SkeletonFrame>
  );
}
