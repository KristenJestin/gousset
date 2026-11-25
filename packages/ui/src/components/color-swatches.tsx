import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { useId } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { focusRing } from "../lib/form-classes";
import { PALETTE_COLORS, PALETTE_TILE_CLASSES } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Icon } from "./icon";

/** The radio of the automatic choice: no palette key is called that. */
const AUTOMATIC = "automatic";

export type ColorSwatchesProps = {
  /** Names the group, shown above it, translated ("Colour"). */
  label: string;
  /** The colour chosen; `null` is the automatic one, when it is offered. */
  value: PaletteColor | null;
  /** Called with the colour chosen, `null` for the automatic one. */
  onChange: (color: PaletteColor | null) => void;
  /**
   * Offers "Automatic" first, with a dot of the colour it gives now (`automaticColorOf(name)`).
   * Left out, there is no automatic choice: a colour of the palette is chosen.
   */
  automatic?: PaletteColor;
  disabled?: boolean;
};

/**
 * Picks a colour from the fixed palette (`PALETTE_COLORS`): a radio group, one tab stop, the
 * arrow keys move and choose, each swatch named for screen readers ("Teal") and the chosen one
 * marked with a check, not by its colour alone. The swatches wrap on a narrow screen.
 *
 * Motion: none of its own; a swatch's check shows at once.
 */
export function ColorSwatches({
  label,
  value,
  onChange,
  automatic,
  disabled = false,
}: ColorSwatchesProps) {
  const messages = useUiMessages().palette;
  const labelId = useId();

  return (
    <div data-slot="color-swatches" className="flex flex-col gap-1.5">
      <span
        id={labelId}
        className={cn("text-sm font-medium text-foreground", disabled && "opacity-50")}
      >
        {label}
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-2"
        value={value ?? (automatic === undefined ? null : AUTOMATIC)}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === AUTOMATIC) {
            onChange(null);

            return;
          }

          const chosen = PALETTE_COLORS.find((color) => color === next);

          if (chosen !== undefined) {
            onChange(chosen);
          }
        }}
      >
        {automatic === undefined ? null : (
          <Radio
            value={AUTOMATIC}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-input bg-card pr-3 pl-1.5 text-sm text-foreground",
              "data-checked:border-foreground",
              "data-disabled:cursor-not-allowed data-disabled:opacity-50",
              focusRing,
            )}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full",
                PALETTE_TILE_CLASSES[automatic],
              )}
            >
              <RadioIndicator className="flex">
                <Icon name="check" size="sm" />
              </RadioIndicator>
            </span>
            {messages.automatic}
          </Radio>
        )}
        {PALETTE_COLORS.map((color) => (
          <Radio
            key={color}
            value={color}
            aria-label={messages.colors[color]}
            className={cn(
              "grid size-8 cursor-pointer place-items-center rounded-full",
              PALETTE_TILE_CLASSES[color],
              "data-disabled:cursor-not-allowed data-disabled:opacity-50",
              focusRing,
            )}
          >
            <RadioIndicator className="flex">
              <Icon name="check" size="md" />
            </RadioIndicator>
          </Radio>
        ))}
      </RadioGroup>
    </div>
  );
}
