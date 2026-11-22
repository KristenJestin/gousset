import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";

import { AppShell, NavLink, Page, ScreenBlock, ScreenTransition, TabLink } from "./app-shell";
import { MenuItem } from "./menu";
import { UserMenu } from "./user-menu";

// The Content Security Policy refuses `style` attributes in the server's markup (a nonce covers
// elements, never an attribute): the frame, as the server draws a first screen, writes none.
describe("the frame on the server", () => {
  test("draws a first screen without a style attribute", () => {
    const html = renderToString(
      <AppShell
        brandLabel="Gousset"
        navigationLabel="Main"
        navigation={
          <>
            <NavLink href="/" icon="review" label="Review" aria-current="page" />
            <NavLink href="/accounts" icon="accounts" label="Accounts" />
          </>
        }
        footer={
          <UserMenu
            name="Ada Example"
            languageLabel="Language"
            language="en"
            languages={[{ value: "en", label: "English" }]}
            onLanguageChange={() => undefined}
            colorSchemeLabel="Colour scheme"
            colorSchemes={{ system: "System", light: "Light", dark: "Dark" }}
          >
            <MenuItem>Sign out</MenuItem>
          </UserMenu>
        }
        tabBar={<TabLink href="/" icon="review" label="Review" aria-current="page" />}
      >
        <ScreenTransition id="/">
          <Page title="Review">
            <ScreenBlock>Nothing yet</ScreenBlock>
          </Page>
        </ScreenTransition>
      </AppShell>,
    );

    expect(html).toContain('data-slot="current-mark"');
    expect(html).toContain('data-slot="screen"');
    expect(html).not.toMatch(/\sstyle="/);
  });
});
