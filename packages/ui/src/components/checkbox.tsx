import { Checkbox as CheckboxPart, CheckboxIndicator } from "@ui-sdk/react/checkbox";

import { focusRing } from "../lib/form-classes";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

export type CheckboxProps = FieldProps & {
  /** Whether it is checked, to control it. */
  checked?: boolean;
  /** Whether it is checked at first, when not controlled. A form reset returns to it. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** What it submits while checked; "on" when left out. */
  value?: string;
  /** The form cannot be sent until it is checked (terms to accept). */
  required?: boolean;
};

/**
 * A choice to tick, on ui-sdk's `Checkbox`, with its label beside it: pressing the label ticks
 * it too. For a setting that takes effect at once, use `Switch`.
 */
export function Checkbox({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  ...props
}: CheckboxProps) {
  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
      inline="start"
    >
      <CheckboxPart
        {...props}
        onCheckedChange={(next) => props.onCheckedChange?.(next === true)}
        className={cn(
          "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs border border-input bg-card text-primary-foreground",
          "transition-colors duration-150 ease-out",
          "data-checked:border-primary data-checked:bg-primary",
          "aria-invalid:border-destructive group-data-invalid/field:border-destructive",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          focusRing,
        )}
      >
        <CheckboxIndicator className="flex transition duration-150 ease-out data-starting-style:scale-50 data-starting-style:opacity-0 data-ending-style:scale-50 data-ending-style:opacity-0">
          <Icon name="check" size="sm" />
        </CheckboxIndicator>
      </CheckboxPart>
    </FormField>
  );
}
