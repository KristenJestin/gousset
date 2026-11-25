import type { ColorSchemeValue } from "@ui-sdk/core";
import { Preferences } from "@ui-sdk/react/preferences";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import {
  accountSchemeScript,
  colorScheme,
  followDarkClass,
  followThemeColor,
} from "@gousset/ui/lib/color-scheme";
import { followReducedMotion } from "@gousset/ui/lib/reduced-motion";

const noSubscribe = () => () => {};

export type ThemeProviderProps = {
  children: ReactNode;
  /**
   * The response's Content Security Policy nonce, which the inline scripts that apply the choice
   * before the first paint must carry.
   */
  nonce?: string;
  /**
   * The signed-in user's colour scheme, kept on their account; nobody's before sign-in, when this
   * browser's choice shows.
   */
  accountScheme?: ColorSchemeValue;
  /**
   * Whose account it is, any value that tells two users apart (their e-mail): the account's
   * scheme is applied once each time someone signs in.
   */
  accountOwner?: string;
};

/**
 * The theme around the whole app, at the top of `<body>`: the colour scheme on `<html>` (before
 * the first paint, from the saved choice), `.dark` and the browser's bars (`theme-color`) kept in
 * step with it, and every Motion
 * animation skipped while the system asks for reduced motion. `<html>` needs
 * `suppressHydrationWarning`, since the saved choice lands on it before hydration.
 *
 * Signed in, the account's choice is the saved one: the server's page writes it in this browser's
 * place before ui-sdk's script reads it, and signing in as someone else without a reload applies
 * theirs at once. Within a sign-in, the choices made in this browser are the newest: a later read
 * of the account, taken between two of their saves, never undoes one.
 *
 * Reduced motion is set in a layout effect: on a hydrated page it runs before any element's
 * entry animation (those start in passive effects), so the first render is already right.
 */
export function ThemeProvider({
  children,
  nonce,
  accountScheme,
  accountOwner,
}: ThemeProviderProps) {
  // Whose account's scheme was applied last: nobody's before sign-in and after sign-out.
  const appliedFor = useRef<string>(undefined);

  useLayoutEffect(() => followReducedMotion(document.documentElement), []);
  useEffect(() => followDarkClass(document.documentElement), []);
  useEffect(() => followThemeColor(document.head), []);
  useEffect(() => {
    if (appliedFor.current === accountOwner) {
      return;
    }

    appliedFor.current = accountOwner;

    if (accountScheme !== undefined) {
      colorScheme.set(accountScheme);
    }
  }, [accountOwner, accountScheme]);

  // The script is the server's, and hydration's: once in the browser, the effect above applies it.
  const fromServer = useSyncExternalStore(
    noSubscribe,
    () => false,
    () => true,
  );

  return (
    <>
      {fromServer && accountScheme !== undefined ? (
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: accountSchemeScript(accountScheme) }}
        />
      ) : null}
      <Preferences
        preferences={[colorScheme]}
        nonce={nonce}
        // Preferences writes `display: contents` as a style attribute, which the Content Security
        // Policy blocks in the server's HTML (a nonce cannot cover an attribute): a class says it.
        className="contents"
        // oxlint-disable-next-line shadcn/no-inline-styles -- removes Preferences' own inline style, sets none.
        style={{ display: undefined }}
      >
        {children}
      </Preferences>
    </>
  );
}
