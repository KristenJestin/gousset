import { describe, expect, test } from "vite-plus/test";

import { isCharacterKeyShortcut } from "./character-keys";

describe("isCharacterKeyShortcut", () => {
  test.each(["?", "/", "K", "1", "Shift+A"] as const)(
    "%s is a character key shortcut",
    (hotkey) => {
      expect(isCharacterKeyShortcut(hotkey)).toBe(true);
    },
  );

  test("a lowercase letter, written as an object, is one", () => {
    expect(isCharacterKeyShortcut({ key: "k" })).toBe(true);
  });

  test("a letter or a digit bound by its physical key is one", () => {
    expect(isCharacterKeyShortcut({ code: "KeyS" })).toBe(true);
    expect(isCharacterKeyShortcut({ code: "Digit1" })).toBe(true);
  });

  test("a sequence of characters is one", () => {
    expect(isCharacterKeyShortcut(["G", "H"])).toBe(true);
  });

  test.each([
    "Mod+/",
    "Mod+K",
    "Control+K",
    "Alt+K",
    "Meta+K",
    "Escape",
    "Enter",
    "ArrowDown",
    "F1",
  ] as const)("%s is not one", (hotkey) => {
    expect(isCharacterKeyShortcut(hotkey)).toBe(false);
  });

  test("a physical key that types no character is not one, nor a letter behind a modifier", () => {
    expect(isCharacterKeyShortcut({ code: "F1" })).toBe(false);
    expect(isCharacterKeyShortcut({ code: "KeyS", mod: true })).toBe(false);
  });

  test("a sequence with a step behind a modifier is not one", () => {
    expect(isCharacterKeyShortcut(["Mod+K", "C"])).toBe(false);
  });
});
