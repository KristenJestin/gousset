import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { useId } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { focusRing } from "../lib/form-classes";
import { PALETTE_COLORS, paletteBackground } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Icon } from "./icon";

/** The value of the choice of no colour. */
const NONE = "none";

export type ColorSwatchesProps = {
  /** What the colour is for, shown above the swatches and naming the group ("Colour"). */
  label: string;
  /** The colour chosen; null for none. */
  value: PaletteColor | null;
  onChange: (color: PaletteColor | null) => void;
  /**
   * Offers no colour, first, with these words ("No colour", "As Housing" for a child that then
   * takes its parent's). Left out: a colour must be chosen.
   */
  noneLabel?: string;
  /** The colour the choice of none stands for (a child's parent's): its swatch shows it, faded. */
  noneColor?: PaletteColor | null;
  disabled?: boolean;
};

const SWATCH = cn(
  "group relative grid size-7 cursor-pointer place-items-center rounded-full",
  "transition-shadow duration-150 ease-out",
  "data-checked:ring-2 data-checked:ring-foreground data-checked:ring-offset-2 data-checked:ring-offset-popover",
  "data-disabled:cursor-not-allowed data-disabled:opacity-50",
  focusRing,
);

/**
 * The check on the chosen swatch: in the surface's colour on a colour (4.5:1 or more on every
 * swatch), in the muted text's on the dashed swatch of no colour.
 */
function Check({ onColor }: { onColor: boolean }) {
  return (
    <span
      className={cn(
        "flex opacity-0 transition-opacity duration-150 group-data-checked:opacity-100",
        onColor ? "text-card" : "text-muted-foreground",
      )}
    >
      <Icon name="check" size="sm" />
    </span>
  );
}

/**
 * One colour of the palette (`--palette-<key>`, docs/design.md, "Colour"), shown as round swatches
 * in a radio group the arrow keys move through, each named for screen readers by its colour's
 * name. The chosen one is ringed and checked. With `noneLabel`, no colour comes first: a dashed
 * swatch, or `noneColor`'s, faded. Shared by whatever the user tints: a category's colour (#205),
 * a merchant's avatar.
 *
 * Motion: the ring and the check of the chosen swatch fade in 150 ms (ease-out). Cut under reduced
 * motion.
 */
export function ColorSwatches({
  label,
  value,
  onChange,
  noneLabel,
  noneColor = null,
  disabled = false,
}: ColorSwatchesProps) {
  const names = useUiMessages().palette;
  const labelId = useId();

  return (
    <div className="flex flex-col gap-1.5" data-slot="color-swatches">
      <span id={labelId} className="text-sm font-medium text-foreground">
        {label}
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2 p-1"
        value={value ?? NONE}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === NONE) {
            onChange(null);

            return;
          }

          const chosen = PALETTE_COLORS.find((color) => color === next);

          if (chosen !== undefined) {
            onChange(chosen);
          }
        }}
      >
        {noneLabel === undefined ? null : (
          <Radio
            value={NONE}
            aria-label={noneLabel}
            title={noneLabel}
            data-color="none"
            className={cn(
              SWATCH,
              noneColor === null
                ? "border border-dashed border-input"
                : cn(paletteBackground[noneColor], "opacity-40 data-checked:opacity-100"),
            )}
          >
            <Check onColor={noneColor !== null} />
          </Radio>
        )}
        {PALETTE_COLORS.map((color) => (
          <Radio
            key={color}
            value={color}
            aria-label={names[color]}
            title={names[color]}
            data-color={color}
            className={cn(SWATCH, paletteBackground[color])}
          >
            <Check onColor />
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}
