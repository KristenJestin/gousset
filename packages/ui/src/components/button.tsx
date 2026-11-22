import { Button as ButtonPart } from "@ui-sdk/react/button";
import type { ButtonActionDetails } from "@ui-sdk/react/button";
import type { MouseEvent, ReactNode } from "react";

import { useUnhurried } from "../hooks/use-unhurried";
import { buttonClasses } from "../lib/button-classes";
import type { ButtonSize, ButtonVariant } from "../lib/button-classes";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { Loader } from "./loader";

export type { ButtonSize, ButtonVariant } from "../lib/button-classes";

export type ButtonProps = {
  children: ReactNode;
  /** `primary` for the one action of a form or a screen, `secondary` for the others. */
  variant?: ButtonVariant;
  /** `sm` in dense rows and toolbars. */
  size?: ButtonSize;
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

type ContentProps = {
  busy: boolean;
  icon: IconName | undefined;
  small: boolean;
  loadingLabel: string | undefined;
  children: ReactNode;
};

function ButtonContent({ busy, icon, small, loadingLabel, children }: ContentProps) {
  const shown = useUnhurried(busy);

  return (
    <>
      {icon === undefined ? null : <IconSlot icon={icon} small={small} shown={shown} />}
      <LabelSlot
        shown={shown}
        hasIcon={icon !== undefined}
        small={small}
        loadingLabel={loadingLabel}
      >
        {children}
      </LabelSlot>
    </>
  );
}

/** The icon, and the loader in its place once shown: one cell, so nothing moves. */
function IconSlot({ icon, small, shown }: { icon: IconName; small: boolean; shown: boolean }) {
  return (
    <span className="grid place-items-center" data-slot="button-icon">
      <span className={cn("col-start-1 row-start-1 flex", shown && "invisible")}>
        <Icon name={icon} size={small ? "sm" : "md"} />
      </span>
      {shown ? (
        <span className="col-start-1 row-start-1 flex">
          <Loader size={small ? "sm" : "md"} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * The label and, stacked in the same cell, what replaces it while loading (the loading label,
 * or the loader alone without an icon): the widest sets the width, which never changes.
 */
function LabelSlot({
  shown,
  hasIcon,
  small,
  loadingLabel,
  children,
}: {
  shown: boolean;
  hasIcon: boolean;
  small: boolean;
  loadingLabel: string | undefined;
  children: ReactNode;
}) {
  const replaced = shown && (!hasIcon || loadingLabel !== undefined);

  return (
    <span className="grid place-items-center">
      {/* Without a loading label, the label stays the button's name: faded out, not removed. */}
      <span
        className={cn(
          "col-start-1 row-start-1",
          replaced && (loadingLabel === undefined ? "opacity-0" : "invisible"),
        )}
      >
        {children}
      </span>
      {replaced || loadingLabel !== undefined ? (
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center gap-2",
            !replaced && "invisible",
          )}
        >
          {hasIcon ? null : <Loader size={small ? "sm" : "md"} />}
          {loadingLabel}
        </span>
      ) : null}
    </span>
  );
}
