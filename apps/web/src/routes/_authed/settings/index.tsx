import { m } from "@gousset/i18n/messages";
import { getLocale, locales, setLocale } from "@gousset/i18n/runtime";
import type { Locale } from "@gousset/i18n/runtime";
import { Block } from "@gousset/ui/components/app-shell";
import { ColorSchemePicker } from "@gousset/ui/components/color-scheme-picker";
import { SegmentedChoice } from "@gousset/ui/components/segmented-choice";
import { createFileRoute } from "@tanstack/react-router";

/** Each language, in its own words: the same in every language. */
const LANGUAGE_NAMES = {
  en: m.languageEnglish,
  fr: m.languageFrench,
} satisfies { [locale in Locale]: () => string };

/**
 * The general settings: how the interface looks and speaks. The blocks to come land here, one
 * under the other: the colour scheme kept on the account (#50), turning off the single-key
 * shortcuts (#54), the AI agents' door (#39).
 */
export const Route = createFileRoute("/_authed/settings/")({
  component: GeneralSettings,
});

function GeneralSettings() {
  return (
    <>
      <Block title={m.settingsLanguageTitle()} description={m.settingsLanguageDescription()}>
        <SegmentedChoice
          label={m.settingsLanguageTitle()}
          value={getLocale()}
          choices={locales.map((locale) => ({ value: locale, label: LANGUAGE_NAMES[locale]() }))}
          onChange={(locale) => void setLocale(locale)}
        />
      </Block>
      <Block title={m.settingsColorSchemeTitle()} description={m.settingsColorSchemeDescription()}>
        <ColorSchemePicker
          label={m.settingsColorSchemeTitle()}
          choices={{
            system: m.colorSchemeSystem(),
            light: m.colorSchemeLight(),
            dark: m.colorSchemeDark(),
          }}
        />
      </Block>
    </>
  );
}
