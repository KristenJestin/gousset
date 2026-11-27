import { Input } from "@ui-sdk/react/input";
import { Toggle } from "@ui-sdk/react/toggle";
import { useEffect, useId, useRef, useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { controlClasses, focusRing, groupFocusRing } from "../lib/form-classes";
import {
  foldedFiltersCount,
  hasOperationsFilters,
  MAX_FILTER_TEXT,
  NO_OPERATIONS_FILTERS,
} from "../lib/operations";
import type { OperationsFilterValues } from "../lib/operations";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { DatePicker } from "./date-picker";
import { Icon } from "./icon";
import { Select } from "./select";
import type { ChoiceItem } from "./select";
import { Sheet } from "./sheet";
import { FormField, TextField } from "./text-field";

export type { OperationsFilterValues } from "../lib/operations";

export type OperationsFiltersProps = {
  values: OperationsFilterValues;
  /** Every change, at once: the page debounces what it sends to the server. */
  onChange: (values: OperationsFilterValues) => void;
  /** The accounts to choose from, by id and name; "All accounts" comes first on its own. */
  accounts: ReadonlyArray<ChoiceItem>;
  /**
   * The subjects to choose from (#37), in tree order, each by its path ("House > Garden shed");
   * "All subjects" comes first on its own. None: no subject filter, unless one is set.
   */
  subjects?: ReadonlyArray<ChoiceItem>;
  /** A bound the page cannot read ("12.5.0"), said under the filters. */
  minError?: string;
  maxError?: string;
  /** How many lines match, on the filters sheet's button ("Show 1,234 lines"); left out while it loads. */
  count?: number;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

// The select's own value for "All accounts" ("All subjects"), which the page reads as `null`: no
// account's or subject's id is ever this.
const ALL_ACCOUNTS = "*";
const ALL_SUBJECTS = "*";

/**
 * The operations' filter bar (docs/wireframes, screen 2, block 1), controlled: words to search in
 * the labels, the account ("All accounts" first), the subject ("All subjects" first, once the user
 * has one, #37), the period (from, to: each clearable), the amount's bounds (typed as decimals, read by the page) and "To review only". Each change goes to
 * `onChange` at once; debouncing the search is the page's. The words and each bound stop at
 * `MAX_FILTER_TEXT` characters, what the server reads. "Clear filters" is `ClearFilters`, which the
 * page puts on the count's line.
 *
 * Where the bar has 1,024 px (a container query: the screen less the sidebar), every filter sits on
 * one 32 px row, none with a label above it: each says what it is by its placeholder or its value,
 * and keeps its name for screen readers; "To review only" is a toggle button, violet once pressed.
 * Narrower (a phone, a tablet, a laptop's half screen), the search stays and the other filters fold
 * behind a Filters button, which says how many are set and opens them in a sheet, labelled one
 * under the other ("To review only" a checkbox there); they apply as they change, and the sheet's
 * button shows the lines. A bound the page cannot read is said under the bar, whichever is shown.
 *
 * Motion: the toggle's colours move in 150 ms (ease-out), cut under reduced motion; its fields' (a select's list, a calendar) and the sheet's (it slides in
 * from its edge) as theirs.
 */
export function OperationsFilters({
  values,
  onChange,
  accounts,
  subjects = [],
  minError,
  maxError,
  count,
  locale,
}: OperationsFiltersProps) {
  const words = useUiMessages().operations;
  const errorId = useId();
  const set = (change: Partial<OperationsFilterValues>) => onChange({ ...values, ...change });
  // The page gives both bounds the same refusal: it is said once.
  const errors = [...new Set([minError, maxError].filter((error) => error !== undefined))];
  const accountItems = [{ value: ALL_ACCOUNTS, label: words.allAccounts }, ...accounts];
  const accountValue = values.accountId ?? ALL_ACCOUNTS;

  const chooseAccount = (chosen: string | null) =>
    set({ accountId: chosen === null || chosen === ALL_ACCOUNTS ? null : chosen });

  // A subject set by the address stays choosable, even when the user has none any more.
  const subjectChoice =
    subjects.length === 0 && values.subjectId === null
      ? undefined
      : {
          items: [{ value: ALL_SUBJECTS, label: words.allSubjects }, ...subjects],
          value: values.subjectId ?? ALL_SUBJECTS,
          choose: (chosen: string | null) =>
            set({ subjectId: chosen === null || chosen === ALL_SUBJECTS ? null : chosen }),
        };

  return (
    <div
      role="group"
      aria-label={words.filters}
      data-slot="operations-filters"
      className="@container flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            label={words.search}
            placeholder={words.searchPlaceholder}
            value={values.search}
            onValueChange={(search) => set({ search })}
          />
        </div>
        {/* The row's own filters: laid out from 1,024 px of bar, gone from the page below. */}
        <div className="hidden @5xl:contents">
          {/* With the subject's beside it, both narrower: the search keeps its room. */}
          <div className={cn("shrink-0", subjectChoice === undefined ? "w-44" : "w-36")}>
            <Select
              label={words.account}
              hideLabel
              size="sm"
              items={accountItems}
              value={accountValue}
              onValueChange={chooseAccount}
            />
          </div>
          {subjectChoice === undefined ? null : (
            <div className="w-36 shrink-0">
              <Select
                label={words.subject}
                hideLabel
                size="sm"
                items={subjectChoice.items}
                value={subjectChoice.value}
                onValueChange={subjectChoice.choose}
              />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="w-34">
              <DatePicker
                label={words.from}
                hideLabel
                hideHint
                placeholder={words.from}
                size="sm"
                value={values.from}
                max={values.to ?? undefined}
                onValueChange={(from) => set({ from })}
              />
            </div>
            <span aria-hidden="true" className="text-sm text-muted-foreground">
              –
            </span>
            <div className="w-34">
              <DatePicker
                label={words.to}
                hideLabel
                hideHint
                placeholder={words.to}
                size="sm"
                value={values.to}
                min={values.from ?? undefined}
                onValueChange={(to) => set({ to })}
              />
            </div>
          </div>
          <AmountRange
            values={values}
            onChange={set}
            invalid={{ min: minError !== undefined, max: maxError !== undefined }}
            describedBy={errors.length === 0 ? undefined : errorId}
          />
          {/* One toggle button, as the prototype draws it: a box inside a bordered pill doubled
              the pressed state, two violet edges whose corners did not match (#184). */}
          <Toggle
            pressed={values.toReview}
            onPressedChange={(toReview) => set({ toReview })}
            className={cn(
              "flex h-8 shrink-0 cursor-pointer items-center rounded-md border border-input bg-card px-3 text-sm font-medium whitespace-nowrap text-soft-foreground",
              "transition-colors duration-150 ease-out",
              "data-pressed:border-primary/45 data-pressed:bg-primary/10 data-pressed:text-primary",
              focusRing,
            )}
          >
            {words.onlyToReview}
          </Toggle>
        </div>
        <FiltersSheet
          values={values}
          onChange={onChange}
          accountItems={accountItems}
          accountValue={accountValue}
          chooseAccount={chooseAccount}
          subjectChoice={subjectChoice}
          minError={minError}
          maxError={maxError}
          count={count}
          locale={locale}
        />
      </div>
      {errors.length === 0 ? null : (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}

/** "Clear filters", once any filter is set: every filter back to none, at once. */
export function ClearFilters({
  values,
  onChange,
}: Pick<OperationsFiltersProps, "values" | "onChange">) {
  const words = useUiMessages().operations;

  return hasOperationsFilters(values) ? (
    <Button variant="ghost" size="sm" icon="close" onClick={() => onChange(NO_OPERATIONS_FILTERS)}>
      {words.clear}
    </Button>
  ) : null;
}

/**
 * The amount's bounds as one field pair under one word, "Amount min – max", the height of the
 * row. Each bound keeps its own name ("Amount from", "Amount up to") for screen readers.
 */
function AmountRange({
  values,
  onChange,
  invalid,
  describedBy,
}: {
  values: OperationsFilterValues;
  onChange: (change: Partial<OperationsFilterValues>) => void;
  invalid: { min: boolean; max: boolean };
  describedBy: string | undefined;
}) {
  const words = useUiMessages().operations;

  const bound =
    "h-full w-14 min-w-0 bg-transparent px-1.5 tabular-nums outline-none placeholder:text-muted-foreground";

  return (
    <div
      role="group"
      aria-label={words.amount}
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md border border-input bg-card text-sm text-foreground",
        "transition-colors duration-150 ease-out",
        (invalid.min || invalid.max) && "border-destructive",
        groupFocusRing,
      )}
    >
      <span aria-hidden="true" className="ps-2.5 pe-1 text-muted-foreground">
        {words.amount}
      </span>
      <input
        aria-label={words.min}
        aria-invalid={invalid.min || undefined}
        aria-describedby={invalid.min ? describedBy : undefined}
        placeholder={words.minPlaceholder}
        inputMode="decimal"
        autoComplete="off"
        maxLength={MAX_FILTER_TEXT}
        value={values.min}
        onChange={(event) => onChange({ min: event.target.value })}
        className={bound}
      />
      <span aria-hidden="true" className="text-muted-foreground">
        –
      </span>
      <input
        aria-label={words.max}
        aria-invalid={invalid.max || undefined}
        aria-describedby={invalid.max ? describedBy : undefined}
        placeholder={words.maxPlaceholder}
        inputMode="decimal"
        autoComplete="off"
        maxLength={MAX_FILTER_TEXT}
        value={values.max}
        onChange={(event) => onChange({ max: event.target.value })}
        className={cn(bound, "me-1")}
      />
    </div>
  );
}

/**
 * The filters a narrow bar folds: a Filters button, with how many are set, opening them in a
 * sheet (from the bottom on a phone, from the side on a wider screen), labelled one under the
 * other. They apply as they change; the sheet's button closes it on the lines.
 */
function FiltersSheet({
  values,
  onChange,
  accountItems,
  accountValue,
  chooseAccount,
  subjectChoice,
  minError,
  maxError,
  count,
  locale,
}: Pick<
  OperationsFiltersProps,
  "values" | "onChange" | "minError" | "maxError" | "count" | "locale"
> & {
  accountItems: ReadonlyArray<ChoiceItem>;
  accountValue: string;
  chooseAccount: (chosen: string | null) => void;
  subjectChoice: SubjectChoice | undefined;
}) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const [open, setOpen] = useState(false);
  const place = useRef<HTMLDivElement>(null);
  const countId = useId();
  const folded = foldedFiltersCount(values);

  // The sheet is drawn outside the bar, where its container query does not reach: once the bar
  // widens to its row (a tablet turned), the button's place is hidden and the open sheet closes.
  useEffect(() => {
    const element = place.current;

    if (element === null) {
      return;
    }

    const watched = new ResizeObserver(() => {
      if (element.offsetWidth === 0) {
        setOpen(false);
      }
    });

    watched.observe(element);

    return () => watched.disconnect();
  }, []);

  const set = (change: Partial<OperationsFilterValues>) => onChange({ ...values, ...change });

  return (
    <div ref={place} className="shrink-0 @5xl:hidden">
      <Sheet
        title={words.filters}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button
            variant="secondary"
            size="sm"
            icon="filters"
            // Named by its words alone ("Filters"), the badge's number heard as its description.
            aria-describedby={folded === 0 ? undefined : countId}
          >
            <span className="inline-flex items-center gap-1.5">
              {words.filters}
              {folded === 0 ? null : (
                <span
                  id={countId}
                  aria-hidden="true"
                  className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 font-semibold text-primary-foreground tabular-nums"
                >
                  {folded}
                </span>
              )}
            </span>
          </Button>
        }
        actions={
          <>
            {hasOperationsFilters(values) ? (
              <Button variant="ghost" onClick={() => onChange(NO_OPERATIONS_FILTERS)}>
                {words.clear}
              </Button>
            ) : null}
            <Button onClick={() => setOpen(false)}>
              {count === undefined
                ? words.showTheLines
                : words.showLines(count, formatCount(count, locale ?? pageLocale))}
            </Button>
          </>
        }
      >
        {/* Room for the fields' focus rings inside the scrolling body. */}
        <div className="flex flex-col gap-4 p-1">
          <Select
            label={words.account}
            items={accountItems}
            value={accountValue}
            onValueChange={chooseAccount}
          />
          {subjectChoice === undefined ? null : (
            <Select
              label={words.subject}
              items={subjectChoice.items}
              value={subjectChoice.value}
              onValueChange={subjectChoice.choose}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label={words.from}
              value={values.from}
              max={values.to ?? undefined}
              onValueChange={(from) => set({ from })}
            />
            <DatePicker
              label={words.to}
              value={values.to}
              min={values.from ?? undefined}
              onValueChange={(to) => set({ to })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={words.min}
              inputMode="decimal"
              autoComplete="off"
              maxLength={MAX_FILTER_TEXT}
              placeholder={words.minPlaceholder}
              value={values.min}
              error={minError}
              onChange={(event) => set({ min: event.target.value })}
            />
            <TextField
              label={words.max}
              inputMode="decimal"
              autoComplete="off"
              maxLength={MAX_FILTER_TEXT}
              placeholder={words.maxPlaceholder}
              value={values.max}
              error={maxError}
              onChange={(event) => set({ max: event.target.value })}
            />
          </div>
          <Checkbox
            label={words.onlyToReview}
            checked={values.toReview}
            onCheckedChange={(toReview) => set({ toReview })}
          />
        </div>
      </Sheet>
    </div>
  );
}

/** The subject's choice, as the row and the sheet both draw it. */
type SubjectChoice = {
  items: ReadonlyArray<ChoiceItem>;
  value: string;
  choose: (chosen: string | null) => void;
};

/** A text field with a search icon before the words, on the same field as `TextField`. */
function SearchField({
  label,
  placeholder,
  value,
  onValueChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <FormField label={label} hideLabel>
      <div className={cn(controlClasses("sm"), groupFocusRing)}>
        <span className="flex shrink-0 text-muted-foreground">
          <Icon name="search" size="sm" />
        </span>
        <Input
          type="search"
          autoComplete="off"
          maxLength={MAX_FILTER_TEXT}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>
    </FormField>
  );
}
