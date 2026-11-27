import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { useId } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { focusRing } from "../lib/form-classes";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { CATEGORY_ICON_NAMES } from "./icons";
import type { CategoryIconName } from "./icons";

export type CategoryIconChoiceProps = {
  /** What the icon is for, shown above the grid and naming the group ("Icon"). */
  label: string;
  /** The icon chosen; null for none yet. */
  value: CategoryIconName | null;
  onChange: (icon: CategoryIconName) => void;
  /** The colour the category is shown in: the chosen icon's tile takes it, as it will be shown. */
  color?: PaletteColor | null;
  disabled?: boolean;
};

/** A chosen tile in each colour: `paletteTile`'s classes (`lib/palette.ts`), once checked. */
const CHECKED_TILE = {
  red: "data-checked:bg-palette-red/15 data-checked:text-palette-red",
  orange: "data-checked:bg-palette-orange/15 data-checked:text-palette-orange",
  amber: "data-checked:bg-palette-amber/15 data-checked:text-palette-amber",
  olive: "data-checked:bg-palette-olive/15 data-checked:text-palette-olive",
  green: "data-checked:bg-palette-green/15 data-checked:text-palette-green",
  teal: "data-checked:bg-palette-teal/15 data-checked:text-palette-teal",
  cyan: "data-checked:bg-palette-cyan/15 data-checked:text-palette-cyan",
  blue: "data-checked:bg-palette-blue/15 data-checked:text-palette-blue",
  indigo: "data-checked:bg-palette-indigo/15 data-checked:text-palette-indigo",
  violet: "data-checked:bg-palette-violet/15 data-checked:text-palette-violet",
  pink: "data-checked:bg-palette-pink/15 data-checked:text-palette-pink",
  grey: "data-checked:bg-palette-grey/15 data-checked:text-palette-grey",
} as const satisfies { [Color in PaletteColor]: string };

/**
 * One of the category icons (`icons.ts`, docs/design.md, "Icons"), in the order they are offered,
 * as a grid of tiles in a radio group the arrow keys move through, each named for screen readers
 * by what it means. The chosen one is drawn as it will be shown, on its colour's tile (or a
 * neutral one), and ringed.
 *
 * Motion: the tiles' colours change in 150 ms (ease-out). Cut under reduced motion.
 */
export function CategoryIconChoice({
  label,
  value,
  onChange,
  color = null,
  disabled = false,
}: CategoryIconChoiceProps) {
  const names = useUiMessages().categoryIcons;
  const labelId = useId();

  return (
    <div className="flex flex-col gap-1.5" data-slot="category-icon-choice">
      <span id={labelId} className="text-sm font-medium text-foreground">
        {label}
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        className="grid grid-cols-8 gap-1 p-1 sm:grid-cols-10"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const chosen = CATEGORY_ICON_NAMES.find((icon) => icon === next);

          if (chosen !== undefined) {
            onChange(chosen);
          }
        }}
      >
        {CATEGORY_ICON_NAMES.map((icon) => (
          <Radio
            key={icon}
            value={icon}
            aria-label={names[icon]}
            title={names[icon]}
            data-icon={icon}
            className={cn(
              "grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground",
              "transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground",
              "data-checked:ring-2 data-checked:ring-foreground",
              color === null
                ? "data-checked:bg-muted data-checked:text-foreground"
                : CHECKED_TILE[color],
              "data-disabled:cursor-not-allowed data-disabled:opacity-50",
              focusRing,
            )}
          >
            <Icon name={icon} />
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}
