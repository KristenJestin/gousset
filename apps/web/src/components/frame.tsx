import { m } from "@gousset/i18n/messages";
import { getLocale, locales, setLocale } from "@gousset/i18n/runtime";
import type { Locale } from "@gousset/i18n/runtime";
import { AppShell, ScreenTransition, TabButton } from "@gousset/ui/components/app-shell";
import { Menu, MenuItem, MenuSeparator } from "@gousset/ui/components/menu";
import { UserMenu } from "@gousset/ui/components/user-menu";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { colorSchemeKept, keepColorScheme } from "@/lib/account-color-scheme";
import { authClient } from "@/lib/auth-client";
import { useShowShortcuts } from "@/shortcuts";

import { AppNavLink, AppTabLink } from "./app-link";

/** Each language, in its own words: the same in every language. */
const LANGUAGE_NAMES = {
  en: m.languageEnglish,
  fr: m.languageFrench,
} satisfies { [locale in Locale]: () => string };

/** The review is current on `/` alone, whatever month its address holds (`?month=…`). */
const REVIEW_ACTIVE = { exact: true, includeSearch: false };

type FrameProps = {
  user: { name: string; isAdmin: boolean };
  children: ReactNode;
};

/**
 * The app's frame around every signed-in screen (docs/wireframes): the sidebar with the screens,
 * the settings and the user's menu; on a phone, the tab bar of the `mobile` wireframe, its "More"
 * holding the other screens and the account.
 */
export function Frame({ user, children }: FrameProps) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const showShortcuts = useShowShortcuts();

  async function signOut() {
    await authClient.signOut();
    await navigate({ to: "/sign-in" });
  }

  const account = (
    <>
      <MenuItem icon="password" onSelect={() => navigate({ to: "/change-password" })}>
        {m.userMenuChangePassword()}
      </MenuItem>
      {user.isAdmin ? (
        <MenuItem icon="users" onSelect={() => navigate({ to: "/users" })}>
          {m.userMenuUsers()}
        </MenuItem>
      ) : null}
      {/* Always here, whatever the setting: the list's way in that needs no shortcut at all. */}
      <MenuItem icon="shortcuts" onSelect={showShortcuts}>
        {m.userMenuShortcuts()}
      </MenuItem>
      <MenuItem icon="signOut" onSelect={signOut}>
        {m.userMenuSignOut()}
      </MenuItem>
    </>
  );

  return (
    <AppShell
      brandLabel={m.appName()}
      navigationLabel={m.navLabel()}
      navigation={
        <>
          <AppNavLink to="/" activeOptions={REVIEW_ACTIVE} icon="review" label={m.navReview()} />
          <AppNavLink to="/operations" icon="operations" label={m.navOperations()} />
          <AppNavLink to="/accounts" icon="accounts" label={m.navAccounts()} />
          <AppNavLink to="/investments" icon="investments" label={m.navInvestments()} />
          <AppNavLink to="/subjects" icon="subjects" label={m.navSubjects()} />
          <AppNavLink to="/import" icon="import" label={m.navImport()} />
        </>
      }
      footer={
        <>
          <AppNavLink to="/settings" icon="settings" label={m.navSettings()} />
          <UserMenu
            name={user.name}
            languageLabel={m.userMenuLanguage()}
            language={getLocale()}
            languages={locales.map((locale) => ({
              value: locale,
              label: LANGUAGE_NAMES[locale](),
            }))}
            // The new language reloads the page, which the server paints in the account's scheme:
            // a scheme just picked reaches the account first.
            onLanguageChange={(locale) => void colorSchemeKept().then(() => setLocale(locale))}
            colorSchemeLabel={m.userMenuColorScheme()}
            colorSchemes={{
              system: m.colorSchemeSystem(),
              light: m.colorSchemeLight(),
              dark: m.colorSchemeDark(),
            }}
            onColorSchemeChange={(scheme) => void keepColorScheme(scheme)}
          >
            {account}
          </UserMenu>
        </>
      }
      tabBar={
        <>
          <AppTabLink to="/" activeOptions={REVIEW_ACTIVE} icon="review" label={m.navReview()} />
          <AppTabLink to="/operations" icon="operations" label={m.navOperations()} />
          <AppTabLink to="/accounts" icon="accounts" label={m.navAccounts()} />
          <Menu trigger={<TabButton icon="more" label={m.navMore()} />} align="end">
            <MenuItem icon="investments" onSelect={() => navigate({ to: "/investments" })}>
              {m.navInvestments()}
            </MenuItem>
            <MenuItem icon="subjects" onSelect={() => navigate({ to: "/subjects" })}>
              {m.navSubjects()}
            </MenuItem>
            <MenuItem icon="import" onSelect={() => navigate({ to: "/import" })}>
              {m.navImport()}
            </MenuItem>
            <MenuItem icon="settings" onSelect={() => navigate({ to: "/settings" })}>
              {m.navSettings()}
            </MenuItem>
            <MenuSeparator />
            {account}
          </Menu>
        </>
      }
    >
      <ScreenTransition id={pathname}>{children}</ScreenTransition>
    </AppShell>
  );
}
