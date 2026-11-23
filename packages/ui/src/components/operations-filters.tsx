import { Input } from "@ui-sdk/react/input";

import { useUiMessages } from "../hooks/use-ui-messages";
import { controlClasses, groupFocusRing } from "../lib/form-classes";
import { hasOperationsFilters, MAX_FILTER_TEXT, NO_OPERATIONS_FILTERS } from "../lib/operations";
import type { OperationsFilterValues } from "../lib/operations";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { DatePicker } from "./date-picker";
import { Icon } from "./icon";
import { Select } from "./select";
import type { ChoiceItem } from "./select";
import { FormField, TextField } from "./text-field";

export type { OperationsFilterValues } from "../lib/operations";

export type OperationsFiltersProps = {
  values: OperationsFilterValues;
  /** Every change, at once: the page debounces what it sends to the server. */
  onChange: (values: OperationsFilterValues) => void;
  /** The accounts to choose from, by id and name; "All accounts" comes first on its own. */
  accounts: ReadonlyArray<ChoiceItem>;
  /** A bound the page cannot read ("12.5.0"), shown under its field. */
  minError?: string;
  maxError?: string;
};

// The select's own value for "All accounts", which the page reads as `null`: no account's id is
// ever this.
const ALL_ACCOUNTS = "*";

/**
 * The operations' filter bar (docs/wireframes, screen 2, block 1), controlled: words to search in
 * the labels, the account ("All accounts" first), the period (from, to: each clearable), the
 * amount's bounds (typed as decimals, read by the page) and "To review only"; "Clear filters"
 * once any is set. It composes the form fields as they are and wraps on a narrow screen. Each
 * change goes to `onChange` at once; debouncing the search is the page's. The words and each
 * bound stop at `MAX_FILTER_TEXT` characters, what the server reads.
 *
 * Motion: none of its own; its fields' (a select's list, a calendar) as theirs.
 */
export function OperationsFilters({
  values,
  onChange,
  accounts,
  minError,
  maxError,
}: OperationsFiltersProps) {
  const words = useUiMessages().operations;
  const set = (change: Partial<OperationsFilterValues>) => onChange({ ...values, ...change });

  return (
    <div
      role="group"
      aria-label={words.filters}
      data-slot="operations-filters"
      className="flex flex-wrap items-start gap-3"
    >
      <div className="w-full sm:w-64">
        <SearchField
          label={words.search}
          placeholder={words.searchPlaceholder}
          value={values.search}
          onValueChange={(search) => set({ search })}
        />
      </div>
      <div className="w-full sm:w-48">
        <Select
          label={words.account}
          size="sm"
          items={[{ value: ALL_ACCOUNTS, label: words.allAccounts }, ...accounts]}
          value={values.accountId ?? ALL_ACCOUNTS}
          onValueChange={(chosen) =>
            set({ accountId: chosen === null || chosen === ALL_ACCOUNTS ? null : chosen })
          }
        />
      </div>
      <div className="flex w-full gap-3 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-40">
          <DatePicker
            label={words.from}
            size="sm"
            value={values.from}
            max={values.to ?? undefined}
            onValueChange={(from) => set({ from })}
          />
        </div>
        <div className="min-w-0 flex-1 sm:w-40">
          <DatePicker
            label={words.to}
            size="sm"
            value={values.to}
            min={values.from ?? undefined}
            onValueChange={(to) => set({ to })}
          />
        </div>
      </div>
      <div className="flex w-full gap-3 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-28">
          <TextField
            label={words.min}
            size="sm"
            inputMode="decimal"
            autoComplete="off"
            maxLength={MAX_FILTER_TEXT}
            value={values.min}
            error={minError}
            onChange={(event) => set({ min: event.target.value })}
          />
        </div>
        <div className="min-w-0 flex-1 sm:w-28">
          <TextField
            label={words.max}
            size="sm"
            inputMode="decimal"
            autoComplete="off"
            maxLength={MAX_FILTER_TEXT}
            value={values.max}
            error={maxError}
            onChange={(event) => set({ max: event.target.value })}
          />
        </div>
      </div>
      {/* The label's height, so that the box lines up with the fields beside it. */}
      <div className="flex h-14 items-end pb-1.5">
        <Checkbox
          label={words.onlyToReview}
          checked={values.toReview}
          onCheckedChange={(toReview) => set({ toReview })}
        />
      </div>
      {hasOperationsFilters(values) ? (
        <div className="flex h-14 items-end">
          <Button variant="secondary" size="sm" onClick={() => onChange(NO_OPERATIONS_FILTERS)}>
            {words.clear}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

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
    <FormField label={label}>
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
