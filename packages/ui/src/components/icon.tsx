import { cn } from "../lib/utils";
import { categoryIcons, interfaceIcons } from "./icons";
import type { CategoryIconName } from "./icons";

export { CATEGORY_ICON_NAMES } from "./icons";

export type { CategoryIconName } from "./icons";

export type InterfaceIconName = keyof typeof interfaceIcons;

export type IconName = InterfaceIconName | CategoryIconName;

const ICONS = { ...interfaceIcons, ...categoryIcons };

/** Whether a stored or typed name is one of Gousset's icons. */
export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

/** The interface's icons, in the order `icons.ts` declares them. */
export const INTERFACE_ICON_NAMES = Object.keys(interfaceIcons).filter(isIconName);

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
