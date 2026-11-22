import type { ColorSchemeValue } from "@ui-sdk/core";
import { usePreference } from "@ui-sdk/react/preferences";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";

import { colorScheme } from "@gousset/ui/lib/color-scheme";

const CHOICES = ["system", "light", "dark"] as const satisfies ReadonlyArray<ColorSchemeValue>;

export type ColorSchemePickerProps = {
  /** The group's accessible name, translated ("Colour scheme"). */
  label: string;
  /** Each choice's words, translated. */
  choices: { readonly [Choice in ColorSchemeValue]: string };
  /** Shows the choice without letting it change, like while a setting saves. */
  disabled?: boolean;
};

/**
 * Chooses the colour scheme: follow the system, or force light or dark. The choice applies at
 * once, everywhere, without a reload, and is kept for the next visit. Needs `ThemeProvider`
 * above it.
 */
export function ColorSchemePicker({ label, choices, disabled = false }: ColorSchemePickerProps) {
  const { value } = usePreference(colorScheme);

  return (
    <RadioGroup
      aria-label={label}
      className="inline-flex w-fit gap-1 rounded-lg border bg-muted p-1"
      value={value}
      disabled={disabled}
      onValueChange={(next, details) => {
        if (next !== null) {
          colorScheme.set(next, { reason: details.reason, event: details.event });
        }
      }}
    >
      {CHOICES.map((choice) => (
        <Radio
          key={choice}
          value={choice}
          className="rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground data-checked:bg-card data-checked:text-foreground data-checked:shadow-sm data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:text-muted-foreground"
        >
          {choices[choice]}
        </Radio>
      ))}
    </RadioGroup>
  );
}
