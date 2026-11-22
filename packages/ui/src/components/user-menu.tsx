import type { ColorSchemeValue } from "@ui-sdk/core";
import { usePreference } from "@ui-sdk/react/preferences";
import type { ReactNode } from "react";

import { colorScheme } from "../lib/color-scheme";
import { NavButton } from "./app-shell";
import { Menu, MenuChoices, MenuSeparator } from "./menu";

const SCHEMES = ["system", "light", "dark"] as const satisfies ReadonlyArray<ColorSchemeValue>;

export type UserMenuProps<Language extends string> = {
  /** Who is signed in: the trigger's words. */
  name: string;
  /** The language heading, the language shown, and each language in its own words. */
  languageLabel: string;
  language: Language;
  languages: ReadonlyArray<{ value: Language; label: string }>;
  /** Changing the language (the app reloads the page in it). */
  onLanguageChange: (language: Language) => void;
  /** The colour scheme heading, and each choice's words. */
  colorSchemeLabel: string;
  colorSchemes: { readonly [Scheme in ColorSchemeValue]: string };
  /** The account's actions after them: change the password, the users, sign out. */
  children: ReactNode;
};

/**
 * The user's menu at the sidebar's foot: the language, the colour scheme (applied at once, kept
 * in this browser) and the account's actions. Motion: as `Menu`.
 */
export function UserMenu<Language extends string>({
  name,
  languageLabel,
  language,
  languages,
  onLanguageChange,
  colorSchemeLabel,
  colorSchemes,
  children,
}: UserMenuProps<Language>) {
  const { value } = usePreference(colorScheme);

  return (
    <Menu trigger={<NavButton icon="user" label={name} />} align="start">
      <MenuChoices
        label={languageLabel}
        value={language}
        choices={languages}
        onChange={onLanguageChange}
      />
      <MenuSeparator />
      <MenuChoices
        label={colorSchemeLabel}
        value={value}
        choices={SCHEMES.map((scheme) => ({ value: scheme, label: colorSchemes[scheme] }))}
        onChange={(scheme) => colorScheme.set(scheme)}
      />
      <MenuSeparator />
      {children}
    </Menu>
  );
}
