import { Switch as SwitchPart, SwitchThumb } from "@ui-sdk/react/switch";

import { focusRing } from "../lib/form-classes";
import { cn } from "../lib/utils";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

export type SwitchProps = FieldProps & {
  /** Whether it is on, to control it. */
  checked?: boolean;
  /** Whether it is on at first, when not controlled. A form reset returns to it. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** What it submits while on; "on" when left out. */
  value?: string;
  required?: boolean;
};

/**
 * A setting that takes effect as soon as it changes, on ui-sdk's `Switch` (the `switch` role):
 * its label says what the setting is and stays the same on and off; the switch sits at the end
 * of the line.
 */
export function Switch({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  ...props
}: SwitchProps) {
  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
      inline="end"
    >
      <SwitchPart
        {...props}
        className={cn(
          "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-0.5",
          "transition-colors duration-150 ease-out",
          "data-checked:bg-primary",
          "aria-invalid:border-destructive group-data-invalid/field:border-destructive",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          focusRing,
        )}
      >
        <SwitchThumb
          className={cn(
            "size-4 rounded-full bg-card shadow-sm",
            "transition duration-150 ease-out",
            "data-checked:translate-x-4 data-checked:bg-primary-foreground rtl:data-checked:-translate-x-4",
            "dark:data-unchecked:bg-foreground",
          )}
        />
      </SwitchPart>
    </FormField>
  );
}
