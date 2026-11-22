import {
  CalendarDay,
  CalendarGrid,
  CalendarHeading,
  CalendarNext,
  CalendarPrevious,
  CalendarWeekday,
  CalendarWeekdays,
  CalendarWeeks,
  DatePicker as DatePickerPart,
  DatePickerContent,
  DatePickerHint,
  DatePickerInput,
  DatePickerTrigger,
} from "@ui-sdk/react/date-picker";
import { useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { controlClasses, focusRing, groupFocusRing, popupClasses } from "../lib/form-classes";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

export type DatePickerProps = FieldProps & {
  /** The chosen day as an ISO date ("2026-10-16"), to control it; `null` for none. */
  value?: string | null;
  /** The day chosen at first, when not controlled. A form reset returns to it. */
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  /** The earliest day that can be chosen, as an ISO date. */
  min?: string;
  /** The latest day that can be chosen, as an ISO date. */
  max?: string;
  required?: boolean;
  /** `sm` in dense rows and toolbars, the height of a small button. */
  size?: "md" | "sm";
};

const stepClasses = cn(
  "flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground",
  "transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground",
  "data-disabled:cursor-not-allowed data-disabled:opacity-50",
  focusRing,
);

/**
 * A day, typed or chosen in a calendar, on ui-sdk's `DatePicker`. It reads and writes dates in
 * the page's language (`<html lang>`: day first in French, weeks from Monday) and gives the page
 * an ISO date ("2026-10-16"), never a `Date`.
 */
export function DatePicker({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  value,
  defaultValue,
  onValueChange,
  min,
  max,
  required,
  size = "md",
}: DatePickerProps) {
  const messages = useUiMessages().forms;
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
    >
      <DatePickerPart
        value={value}
        defaultValue={defaultValue}
        onValueChange={(next) => onValueChange?.(Array.isArray(next) ? null : next)}
        min={min}
        max={max}
        required={required}
        locale={messages.dateLocale}
        weekStartsOn={messages.weekStartsOn}
        className="flex flex-col gap-1.5"
      >
        <div
          ref={setAnchor}
          className={cn(controlClasses(size), groupFocusRing, "pe-1 has-data-disabled:opacity-50")}
        >
          <DatePickerInput className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground data-disabled:cursor-not-allowed" />
          <DatePickerTrigger
            aria-label={messages.chooseDate}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted data-disabled:cursor-not-allowed"
          >
            <Icon name="calendar" />
          </DatePickerTrigger>
        </div>
        <DatePickerHint className="text-xs text-muted-foreground">
          {(state) => messages.dateFormat(state.example)}
        </DatePickerHint>
        <DatePickerContent
          anchor={anchor}
          align="start"
          sideOffset={4}
          className={cn(popupClasses, "p-3")}
        >
          <CalendarMonth previous={messages.previousMonth} next={messages.nextMonth} />
        </DatePickerContent>
      </DatePickerPart>
    </FormField>
  );
}

/** The calendar inside the popup: the month and its arrows, then its days. */
function CalendarMonth({ previous, next }: { previous: string; next: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 pb-2">
        <CalendarPrevious aria-label={previous} className={stepClasses}>
          <Icon name="previous" />
        </CalendarPrevious>
        <CalendarHeading className="text-sm font-medium first-letter:uppercase" />
        <CalendarNext aria-label={next} className={stepClasses}>
          <Icon name="next" />
        </CalendarNext>
      </div>
      <CalendarGrid className="border-collapse">
        <CalendarWeekdays>
          {(index) => (
            <CalendarWeekday
              index={index}
              className="size-9 p-0 text-xs font-normal text-muted-foreground"
            />
          )}
        </CalendarWeekdays>
        <CalendarWeeks>
          {(cell) => (
            <CalendarDay
              value={cell.date}
              className={cn(
                "size-9 cursor-pointer rounded-md p-0 text-center text-sm tabular-nums outline-none",
                "transition-colors duration-150 ease-out hover:bg-muted",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                "data-today:font-semibold data-today:text-primary",
                "data-selected:bg-primary data-selected:font-medium data-selected:text-primary-foreground",
                "data-outside:text-muted-foreground",
                "data-disabled:cursor-not-allowed data-disabled:opacity-40 data-disabled:hover:bg-transparent",
              )}
            />
          )}
        </CalendarWeeks>
      </CalendarGrid>
    </>
  );
}
