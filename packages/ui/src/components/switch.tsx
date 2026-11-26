import { Switch as SwitchPart, SwitchThumb } from "@ui-sdk/react/switch";

import { useUnhurried } from "../hooks/use-unhurried";
import { focusRing } from "../lib/form-classes";
import { cn } from "../lib/utils";
import { Loader } from "./loader";
import { FormField } from "./text-field";
import type { FieldProps } from "./text-field";

export type SwitchProps = FieldProps & {
  /** Whether it is on, to control it. */
  checked?: boolean;
  /** Whether it is on at first, when not controlled. A form reset returns to it. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * While the value it shows is being saved: `aria-busy`, and the loader in its thumb once the
   * save lasts (after about 300 ms, then at least 500 ms, as a button's). It keeps its focus.
   */
  pending?: boolean;
  /** What it submits while on; "on" when left out. */
  value?: string;
  required?: boolean;
};

/**
 * A setting that takes effect as soon as it changes, on ui-sdk's `Switch` (the `switch` role):
 * its label says what the setting is and stays the same on and off; the switch sits at the end
 * of the line. Saved by the page, it shows the value at once and says it is `pending` until the
 * save ends: only then is the value kept.
 */
export function Switch({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  pending = false,
  ...props
}: SwitchProps) {
  const shown = useUnhurried(pending);

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
        aria-busy={pending || undefined}
        className={cn(
          "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-0.5",
          "transition-colors duration-150 ease-out",
          "data-checked:bg-primary",
          "aria-busy:cursor-progress",
          "aria-invalid:border-destructive group-data-invalid/field:border-destructive",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          focusRing,
        )}
      >
        <SwitchThumb
          className={cn(
            "grid size-4 place-items-center rounded-full bg-card text-muted-foreground shadow-sm",
            "transition duration-150 ease-out",
            "data-checked:translate-x-4 data-checked:bg-primary-foreground data-checked:text-primary rtl:data-checked:-translate-x-4",
            "dark:data-unchecked:bg-foreground dark:data-unchecked:text-background",
          )}
        >
          {shown ? <Loader size="sm" /> : null}
        </SwitchThumb>
      </SwitchPart>
    </FormField>
  );
}
