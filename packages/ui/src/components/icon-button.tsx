import { Button as ButtonPart } from "@ui-sdk/react/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ButtonHTMLAttributes, Ref } from "react";

import { useUnhurried } from "../hooks/use-unhurried";
import { buttonClasses } from "../lib/button-classes";
import { tooltipClasses } from "../lib/overlay-classes";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { Loader } from "./loader";

/**
 * What a part using an `IconButton` as its trigger (`render={<IconButton … />}`) passes down: its
 * handlers, `aria-*` and ref. The look stays the component's own.
 */
type TriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style" | "children" | "aria-label" | "disabled" | "type"
> & { ref?: Ref<HTMLButtonElement> };

export type IconButtonProps = TriggerProps & {
  icon: IconName;
  /** Its accessible name, and the text of the tooltip on hover and focus. Required. */
  label: string;
  /** `ghost` in toolbars and rows (the default), `secondary` beside other buttons. */
  variant?: "ghost" | "secondary";
  /** Square, the height of `Button`: `md` 36 px, `sm` 32 px. */
  size?: "md" | "sm";
  /**
   * While an action runs: disabled and `aria-busy`; the loader takes the icon's place after
   * about 300 ms and stays at least 500 ms.
   */
  loading?: boolean;
  disabled?: boolean;
  /**
   * Keeps the button in the tab order while disabled (`aria-disabled`), for a button that turns
   * disabled under the user's focus (Next on the latest month): the focus stays where it was.
   */
  focusableWhenDisabled?: boolean;
  type?: "button" | "submit" | "reset";
};

/**
 * A button with only an icon, on ui-sdk's `Button`, named by its `label`, which a tooltip also
 * shows on hover (after a short rest) and on keyboard focus.
 *
 * Motion: as `Button` (150 ms colours, a slight press); its tooltip fades in 150 ms. Cut under
 * reduced motion.
 */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  loading = false,
  disabled = false,
  focusableWhenDisabled = false,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip type="label">
      <TooltipTrigger
        {...props}
        aria-label={label}
        render={
          <ButtonPart
            type={type}
            disabled={disabled || loading}
            focusableWhenDisabled={loading || focusableWhenDisabled}
            aria-busy={loading || undefined}
            className={cn(buttonClasses(variant, size), "px-0!", size === "sm" ? "w-8" : "w-9")}
          />
        }
      >
        <IconOrLoader icon={icon} loading={loading} size={size} />
      </TooltipTrigger>
      <TooltipContent className={tooltipClasses}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The icon, and the loader in its place once loading has lasted (`useUnhurried`). */
function IconOrLoader({
  icon,
  loading,
  size,
}: {
  icon: IconName;
  loading: boolean;
  size: "md" | "sm";
}) {
  const shown = useUnhurried(loading);

  return (
    <span className="grid place-items-center" data-slot="button-icon">
      <span className={cn("col-start-1 row-start-1 flex", shown && "invisible")}>
        <Icon name={icon} size={size} />
      </span>
      {shown ? (
        <span className="col-start-1 row-start-1 flex">
          <Loader size={size} />
        </span>
      ) : null}
    </span>
  );
}
