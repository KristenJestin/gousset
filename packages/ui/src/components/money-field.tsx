import { useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { formatMoneyInput, parseMoneyInput } from "../lib/money";
import { TextField } from "./text-field";
import type { FieldProps } from "./text-field";

export type MoneyFieldProps = FieldProps & {
  /** An ISO 4217 code: how many decimals it parses and formats to. */
  currency: string;
  /** Integer minor units at first; a page that must reset the field later changes its `key`. */
  value?: number | null;
  defaultValue?: number | null;
  /** Fires with the parsed minor units on every keystroke; `null` while empty or unreadable. */
  onValueChange?: (minor: number | null) => void;
  /** The page's language (`<html lang>`) unless given: its separators, typed or read back. */
  locale?: string;
  required?: boolean;
  /** `sm` in dense rows and toolbars, the height of a small button. */
  size?: "md" | "sm";
};

/**
 * An amount typed as text (an opening balance, a noted balance), in integer minor units: no
 * currency symbol, the locale's separators, as many decimals as the currency takes. The typed
 * text is read back into minor units at each keystroke (`onValueChange`); it is only reformatted
 * to its canonical form once the field loses focus, so the digits being typed never jump.
 */
export function MoneyField({
  label,
  hideLabel,
  description,
  error,
  disabled,
  name,
  currency,
  value,
  defaultValue,
  onValueChange,
  locale,
  required,
  size = "md",
}: MoneyFieldProps) {
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const format = { locale: writtenIn, currency };
  const initial = value ?? defaultValue ?? null;

  const [text, setText] = useState(() =>
    initial === null ? "" : formatMoneyInput(initial, format),
  );

  return (
    <TextField
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      disabled={disabled}
      name={name}
      required={required}
      size={size}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        const next = event.target.value;

        setText(next);
        onValueChange?.(parseMoneyInput(next, format));
      }}
      onBlur={() => {
        setText((current) => {
          const parsed = parseMoneyInput(current, format);

          return parsed === null ? current : formatMoneyInput(parsed, format);
        });
      }}
    />
  );
}
