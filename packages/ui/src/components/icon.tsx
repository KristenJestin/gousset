import { cn } from "../lib/utils";
import { ICONS } from "./icons";
import type { IconName } from "./icons";

export type { CategoryIconName, IconName, InterfaceIconName } from "./icons";

export type IconProps = {
  name: IconName;
  /** `sm` 14 px, `md` 16 px (the default, beside text), `lg` 20 px, `xl` 24 px. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Said to screen readers. Without it the icon is decoration and hidden from them. */
  label?: string;
};

/**
 * One of Gousset's icons (Tabler, outline, stroke 1.5), by its name in `icons.ts`. It takes the
 * text's colour (`currentColor`). Decorative unless it has a `label`.
 */
export function Icon({ name, size = "md", label }: IconProps) {
  const Drawing = ICONS[name];

  return (
    <Drawing
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : "img"}
      focusable={false}
      className={cn(
        "shrink-0",
        size === "sm" && "size-3.5",
        size === "md" && "size-4",
        size === "lg" && "size-5",
        size === "xl" && "size-6",
      )}
    />
  );
}
