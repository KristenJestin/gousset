import { Button as ButtonPart } from "@ui-sdk/react/button";
import type { ButtonActionDetails } from "@ui-sdk/react/button";
import type { MouseEvent, ReactNode } from "react";

import { useUnhurried } from "../hooks/use-unhurried";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { Loader } from "./loader";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export type ButtonProps = {
  children: ReactNode;
  /** `primary` for the one action of a form or a screen, `secondary` for the others. */
  variant?: ButtonVariant;
  /** `sm` in dense rows and toolbars. */
  size?: "md" | "sm";
  /** An icon before the label; the loader takes its place while loading. */
  icon?: IconName;
  /**
   * While an action runs: disabled and `aria-busy`, keeping its width. The loader shows only
   * after about 300 ms and then stays at least 500 ms, so it never flashes. A `onClick` that
   * returns a promise does the same on its own.
   */
  loading?: boolean;
  /** What the label says while loading ("Importing…"). The button keeps its width. */
  loadingLabel?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  form?: string;
  name?: string;
  value?: string;
  /** Said by screen readers once the action has run a second ("Saving"), translated. */
  pendingAnnouncement?: string;
  onClick?: (event: MouseEvent<HTMLElement>, details: ButtonActionDetails) => Promise<void> | void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
};

/** The classes every button-like control shares: one look, set here. */
export function buttonClasses(variant: ButtonVariant, size: "md" | "sm") {
  return cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none",
    "transition duration-150 ease-out active:scale-97",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:active:scale-100",
    "aria-busy:cursor-progress aria-busy:opacity-100",
    size === "md" && "h-9 px-4 text-sm",
    size === "sm" && "h-8 px-3 text-xs",
    variant === "primary" &&
      "bg-primary text-primary-foreground hover:bg-primary/90 data-disabled:hover:bg-primary",
    variant === "secondary" &&
      "border border-input bg-card text-foreground hover:bg-muted data-disabled:hover:bg-card",
    variant === "ghost" &&
      "bg-transparent text-foreground hover:bg-muted data-disabled:hover:bg-transparent",
    variant === "destructive" &&
      "bg-destructive text-primary-foreground hover:bg-destructive/90 data-disabled:hover:bg-destructive",
  );
}

/**
 * A button on ui-sdk's `Button`: native `<button>`, `type="button"` unless told otherwise.
 *
 * Motion: colours change in 150 ms on hover, it presses in slightly (scale 0.97) and back; cut
 * under reduced motion.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  loadingLabel,
  disabled = false,
  ...props
}: ButtonProps) {
  return (
    <ButtonPart
      {...props}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size)}
    >
      {(state) => (
        <ButtonContent
          busy={loading || state.pending}
          icon={icon}
          small={size === "sm"}
          loadingLabel={loadingLabel}
        >
          {children}
        </ButtonContent>
      )}
    </ButtonPart>
  );
}

function ButtonContent({
  busy,
  icon,
  small,
  loadingLabel,
  children,
}: {
  busy: boolean;
  icon: IconName | undefined;
  small: boolean;
  loadingLabel: string | undefined;
  children: ReactNode;
}) {
  const shown = useUnhurried(busy);
  const loader = <Loader size={small ? "sm" : "md"} />;

  return (
    <>
      {icon === undefined ? null : (
        <span className="grid place-items-center" data-slot="button-icon">
          <span className={cn("col-start-1 row-start-1 flex", shown && "invisible")}>
            <Icon name={icon} size={small ? "sm" : "md"} />
          </span>
          {shown ? <span className="col-start-1 row-start-1 flex">{loader}</span> : null}
        </span>
      )}
      <span className="grid place-items-center">
        <span
          className={cn(
            "col-start-1 row-start-1",
            shown && (icon === undefined || loadingLabel !== undefined) && "invisible",
          )}
        >
          {children}
        </span>
        {loadingLabel === undefined ? null : (
          <span
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-2",
              !shown && "invisible",
            )}
          >
            {icon === undefined ? loader : null}
            {loadingLabel}
          </span>
        )}
        {shown && icon === undefined && loadingLabel === undefined ? (
          <span className="col-start-1 row-start-1 flex">{loader}</span>
        ) : null}
      </span>
    </>
  );
}
