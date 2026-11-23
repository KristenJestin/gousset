import { parseHotkey } from "@tanstack/react-hotkeys";
import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

/** A physical key that types a character: a letter or a digit of the main block. */
const CHARACTER_CODE = /^(?:Key[A-Z]|Digit\d)$/;

/**
 * Whether a hotkey is a character key shortcut in WCAG 2.2's sense (2.1.4): each of its steps is
 * one letter, digit, punctuation mark or symbol, with no modifier but the Shift that types it.
 * Speech input can type one by accident, which is why the user can turn them off.
 */
export function isCharacterKeyShortcut(hotkey: RegisterableHotkey): boolean {
  // Any platform will do: `Mod` is a modifier on every one of them.
  const parsed = parseHotkey(hotkey, "linux");
  const steps = Array.isArray(parsed) ? parsed : [parsed];

  return steps.every(
    (step) =>
      !step.ctrl &&
      !step.alt &&
      !step.meta &&
      (step.code === undefined ? step.key.length === 1 : CHARACTER_CODE.test(step.code)),
  );
}
