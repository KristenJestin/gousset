import { Field, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import type { ComponentProps, ReactNode } from "react";

import { controlClasses, focusRing } from "../lib/form-classes";
import { cn } from "../lib/utils";

/** What every form control takes about its field: its label, its help and its error. */
export type FieldProps = {
  /** Names the control. Always given, even when hidden. */
  label: string;
  /** Hides the label from sight where the layout already says what the control is for; it still names the control. */
  hideLabel?: boolean;
  /** A line of help under the control, linked to it. */
  description?: string;
  /**
   * The error to show (from the server or the page's own checks): the field turns invalid, the
   * control gets `aria-invalid` and the message is linked to it. Without it, the browser's own
   * checks (`required`, `type="email"`) show their message once a submit fails.
   */
  error?: string;
  disabled?: boolean;
  /** The name the value submits under. */
  name?: string;
};

/**
 * A control's field: its label above (or beside, for a checkbox or a switch), its help and its
 * error under it, all linked to the control by ui-sdk's `Field`. A required control's label
 * shows a star, hidden from screen readers, which hear the control's own `required`.
 */
export function FormField({
  label,
  hideLabel = false,
  description,
  error,
  disabled,
  name,
  inline,
  children,
}: FieldProps & {
  /**
   * The control sits on one line with its label: before it (`start`, a checkbox) or at the end
   * of the line (`end`, a switch).
   */
  inline?: "start" | "end";
  children: ReactNode;
}) {
  const labelPart = (
    <FieldLabelPart label={label} hidden={hideLabel} pressable={inline !== undefined} />
  );
  const help = description === undefined ? null : <FieldHelp description={description} />;

  return (
    <Field
      name={name}
      disabled={disabled}
      invalid={error === undefined ? undefined : true}
      className="group/field flex flex-col gap-1.5"
    >
      {inline === undefined ? (
        <>
          {labelPart}
          {children}
          {help}
        </>
      ) : (
        <div className={cn("flex items-start gap-3", inline === "end" && "justify-between")}>
          <span className={cn("flex h-5 shrink-0 items-center", inline === "end" && "order-last")}>
            {children}
          </span>
          <div className="flex flex-col gap-0.5">
            {labelPart}
            {help}
          </div>
        </div>
      )}
      <FieldErrorPart error={error} />
    </Field>
  );
}

/** The label; a required control's shows a star, hidden from screen readers. */
function FieldLabelPart({
  label,
  hidden,
  pressable,
}: {
  label: string;
  hidden: boolean;
  pressable: boolean;
}) {
  return (
    <FieldLabel
      className={cn(
        "text-sm font-medium text-foreground data-disabled:opacity-50",
        hidden && "sr-only",
        pressable && "cursor-pointer data-disabled:cursor-not-allowed",
      )}
    >
      {(state) => (
        <>
          {label}
          {state.required ? (
            <span aria-hidden="true" className="ms-0.5 text-muted-foreground">
              *
            </span>
          ) : null}
        </>
      )}
    </FieldLabel>
  );
}

function FieldHelp({ description }: { description: string }) {
  return (
    <FieldDescription className="text-xs text-muted-foreground data-disabled:opacity-50">
      {description}
    </FieldDescription>
  );
}

/** The page's own error when it gives one, else the browser's message once a submit fails. */
function FieldErrorPart({ error }: { error: string | undefined }) {
  const classes = "text-xs font-medium text-destructive";

  return error === undefined ? (
    <FieldError className={classes} />
  ) : (
    <FieldError match className={classes}>
      {error}
    </FieldError>
  );
}

export type TextFieldProps = FieldProps &
  Omit<
    ComponentProps<typeof Input>,
    "className" | "style" | "render" | "id" | "children" | "controller" | "debug" | "name" | "size"
  > & {
    /** `sm` in dense rows and toolbars, the height of a small button. */
    size?: "md" | "sm";
  };

/**
 * A labelled text input on ui-sdk's `Field` and `Input`: names, e-mails, passwords, amounts
 * typed as text. Every native input attribute passes through (`type`, `autoComplete`,
 * `required`, `minLength`…).
 */
export function TextField({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  size = "md",
  ...props
}: TextFieldProps) {
  return (
    <FormField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
    >
      <Input {...props} className={cn(controlClasses(size), focusRing)} />
    </FormField>
  );
}
