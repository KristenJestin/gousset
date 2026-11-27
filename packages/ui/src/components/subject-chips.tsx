import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { transition } from "../lib/motion";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Chip } from "./chip";
import { Combobox } from "./combobox";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";

// What an expense is for (#37; docs/vision.md, "Subjects"): its subjects as chips, read only in a
// row, or added and removed in a line's detail and in each share of its split.

/** A subject as a chip names it. */
export type SubjectChipView = {
  id: string;
  /** Its own name ("Garden shed"); a choice gives its path ("House > Garden shed"). */
  name: string;
};

/**
 * The chips of the first render are drawn as they are, with no style attribute in the server's
 * markup (the Content Security Policy forbids them); a chip that comes later fades in.
 */
function useArrivals(ids: ReadonlyArray<string>) {
  const [first] = useState(() => new Set(ids));

  return (id: string) =>
    first.has(id) ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 } };
}

export type SubjectChipsProps = {
  subjects: ReadonlyArray<SubjectChipView>;
  /** How many chips are drawn before "+N"; all of them when left out. */
  limit?: number;
};

/**
 * An expense's subjects, read only: a chip each, on one line, the last ones said as "+N" past
 * `limit`. Nothing for none.
 *
 * Motion: a chip that comes fades in, one that goes fades out, in 150 ms (ease-out); those drawn
 * with the page are there at once. Cut under reduced motion.
 */
export function SubjectChips({ subjects, limit }: SubjectChipsProps) {
  const words = useUiMessages().operations;
  const shown = limit === undefined ? subjects : subjects.slice(0, limit);
  const hidden = subjects.length - shown.length;
  const arrives = useArrivals(subjects.map((subject) => subject.id));

  return (
    <LazyMotion features={domMax}>
      <span data-slot="subject-chips" className="flex min-w-0 items-center gap-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {shown.map((subject) => (
            <m.span
              key={subject.id}
              data-slot="subject-chip"
              className="flex min-w-0"
              {...arrives(subject.id)}
              exit={{ opacity: 0 }}
              transition={transition.fast}
            >
              <Chip>{subject.name}</Chip>
            </m.span>
          ))}
        </AnimatePresence>
        {hidden > 0 ? (
          <span className="flex shrink-0">
            <Chip>{words.moreSubjects(hidden)}</Chip>
          </span>
        ) : null}
      </span>
    </LazyMotion>
  );
}

export type SubjectsFieldProps = {
  /** What the field is, its group's name ("Subjects", "Subjects 2"). */
  label: string;
  /** The label is said to screen readers only: a heading beside it already says it. */
  hideLabel?: boolean;
  /** The subjects chosen, in order. */
  chosen: ReadonlyArray<SubjectChipView>;
  /** What "+ Add" offers, by their path: the subjects in use, none archived. */
  choices: ReadonlyArray<SubjectChipView>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** The name of "+ Add" for screen readers, which says what it adds to ("Add a subject"). */
  addLabel: string;
  /** The picker's name, once "+ Add" shows it ("Subject to add"). */
  pickerLabel: string;
  /** A line under the label: what the subjects do here. */
  description?: string;
  /** A refusal, worded by the page, said under the field. */
  error?: string;
};

/**
 * Subjects to choose (docs/wireframes, screen 2, block 3: "Subjects + Add"): a chip each, with its
 * remove button, then "+ Add", which shows a picker of the subjects not chosen yet, found by
 * typing; the picker has the focus, and a choice adds the subject and hides it again. "None yet"
 * while none is chosen. A refusal is said under it.
 *
 * Motion: a chip added fades in, one removed fades out, in 150 ms (ease-out); a remove button's
 * background in 150 ms on hover. Cut under reduced motion.
 */
export function SubjectsField({
  label,
  hideLabel = false,
  chosen,
  choices,
  onAdd,
  onRemove,
  addLabel,
  pickerLabel,
  description,
  error,
}: SubjectsFieldProps) {
  const ui = useUiMessages();
  const words = ui.operations;
  const [adding, setAdding] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const taken = new Set(chosen.map((subject) => subject.id));
  const arrives = useArrivals(chosen.map((subject) => subject.id));

  // The picker, once shown, has the focus: the press on "+ Add" asked for it.
  useEffect(() => {
    if (adding) {
      picker.current?.querySelector("input")?.focus();
    }
  }, [adding]);

  return (
    <div role="group" aria-label={label} data-slot="subjects-field" className="flex flex-col gap-2">
      {hideLabel ? null : <p className="text-sm font-medium text-foreground">{label}</p>}
      {description === undefined ? null : (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <LazyMotion features={domMax}>
        <ul className="flex flex-wrap items-center gap-2">
          <AnimatePresence initial={false}>
            {chosen.map((subject) => (
              <m.li
                key={subject.id}
                data-slot="subject-chip"
                {...arrives(subject.id)}
                exit={{ opacity: 0 }}
                transition={transition.fast}
                className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-muted ps-2.5 pe-0.5 text-xs font-medium"
              >
                <span className="truncate">{subject.name}</span>
                <button
                  type="button"
                  aria-label={ui.pieces.remove(subject.name)}
                  onClick={() => onRemove(subject.id)}
                  className={cn(
                    "grid size-6 shrink-0 cursor-pointer place-items-center rounded-full",
                    "transition-colors duration-150 ease-out hover:bg-foreground/10",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  <Icon name="close" size="sm" />
                </button>
              </m.li>
            ))}
          </AnimatePresence>
          {chosen.length === 0 ? (
            <li className="flex h-7 items-center text-sm text-muted-foreground">
              {words.subjectsNone}
            </li>
          ) : null}
          {adding ? null : (
            <li className="flex">
              <Button
                variant="secondary"
                size="sm"
                icon="add"
                aria-label={addLabel}
                onClick={() => setAdding(true)}
              >
                {words.subjectAdd}
              </Button>
            </li>
          )}
        </ul>
      </LazyMotion>
      {adding ? (
        <div ref={picker}>
          <Combobox
            label={pickerLabel}
            placeholder={words.subjectPlaceholder}
            size="sm"
            items={choices.flatMap((choice) =>
              taken.has(choice.id) ? [] : [{ value: choice.id, label: choice.name }],
            )}
            value={null}
            onValueChange={(id) => {
              if (id !== null) {
                onAdd(id);
                setAdding(false);
              }
            }}
          />
        </div>
      ) : null}
      <FormMessage message={error} />
    </div>
  );
}

export type LineSubjectsProps = Pick<
  SubjectsFieldProps,
  "chosen" | "choices" | "onAdd" | "onRemove" | "error"
>;

/**
 * An expense's subjects in its line's detail (`LineDetail`'s `subjects`), under its category as
 * the wireframe draws it (screen 2, block 3): "Subjects", its chips, "+ Add". The page gives it to
 * an expense alone: an income, a transfer or a held line has no subject.
 *
 * Motion: `SubjectsField`'s: a chip fades in and out in 150 ms, cut under reduced motion.
 */
export function LineSubjects(props: LineSubjectsProps) {
  const words = useUiMessages().operations;

  return (
    <section aria-label={words.subjects} data-slot="line-subjects" className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{words.subjects}</p>
      <SubjectsField
        {...props}
        label={words.subjects}
        hideLabel
        addLabel={words.subjectAddLabel}
        pickerLabel={words.subjectToAdd}
      />
    </section>
  );
}
