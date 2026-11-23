import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import {
  AppShell,
  Block,
  NavLink,
  Page,
  ScreenBlock,
  ScreenTransition,
  SectionLayout,
  SectionLink,
  TabButton,
  TabLink,
} from "./app-shell";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { EmptyState } from "./empty-state";
import type { IconName } from "./icon";
import { List, ListItem } from "./list";
import { MenuItem } from "./menu";
import { MonthSwitcher } from "./month-switcher";
import { TextField } from "./text-field";
import { UserMenu } from "./user-menu";

const SCREENS: ReadonlyArray<{ id: string; icon: IconName; label: string }> = [
  { id: "review", icon: "review", label: "Review" },
  { id: "operations", icon: "operations", label: "Operations" },
  { id: "accounts", icon: "accounts", label: "Accounts" },
  { id: "investments", icon: "investments", label: "Investments" },
  { id: "subjects", icon: "subjects", label: "Subjects" },
  { id: "import", icon: "import", label: "Import" },
];

/** The frame as the app composes it, its links switching screens in place of the router. */
function Frame({ initial = "review" }: { initial?: string }) {
  const [current, setCurrent] = useState(initial);
  const [month, setMonth] = useState({ year: 2026, month: 10 });
  const [language, setLanguage] = useState<"en" | "fr">("en");

  const link = (id: string) => ({
    href: `#${id}`,
    "aria-current": current === id ? ("page" as const) : undefined,
    onClick: () => setCurrent(id),
  });

  const screen = SCREENS.find((item) => item.id === current) ?? { label: "Settings" };

  return (
    <AppShell
      brandLabel="Gousset"
      navigationLabel="Main"
      navigation={SCREENS.map((item) => (
        <NavLink key={item.id} icon={item.icon} label={item.label} {...link(item.id)} />
      ))}
      footer={
        <>
          <NavLink icon="settings" label="Settings" {...link("settings")} />
          <UserMenu
            name="Ada Example"
            languageLabel="Language"
            language={language}
            languages={[
              { value: "en", label: "English" },
              { value: "fr", label: "Français" },
            ]}
            onLanguageChange={setLanguage}
            colorSchemeLabel="Colour scheme"
            colorSchemes={{ system: "System", light: "Light", dark: "Dark" }}
          >
            <MenuItem icon="password">Change password</MenuItem>
            <MenuItem icon="signOut">Sign out</MenuItem>
          </UserMenu>
        </>
      }
      tabBar={
        <>
          {SCREENS.slice(0, 3).map((item) => (
            <TabLink key={item.id} icon={item.icon} label={item.label} {...link(item.id)} />
          ))}
          <TabButton icon="more" label="More" />
        </>
      }
    >
      <ScreenTransition id={current}>
        <Page
          title={screen.label}
          actions={<MonthSwitcher value={month} onChange={setMonth} latest={month} />}
        >
          <ScreenBlock>
            <EmptyState
              title="Nothing to show yet"
              description="Import your bank statements: what fills this screen will show here."
            />
          </ScreenBlock>
        </Page>
      </ScreenTransition>
    </AppShell>
  );
}

/**
 * The app's frame (docs/wireframes): from 768 px a sidebar, narrow (icons) up to 1024 px and wide
 * after, with the mark (and the wordmark when wide), the screens, then the settings and the user's
 * menu at its foot; below 768 px a tab bar (Review, Operations, Accounts, More). A `Page` inside
 * gives the screen its title and what sits beside it.
 *
 * Motion: the screen reached fades in (200 ms, ease-out); the current item's background slides to
 * the item reached (shared layout, 200 ms); an empty screen's block fades in. Cut under reduced
 * motion.
 *
 * Don't: put a second navigation in a page, a block inside a block, or more than four places in
 * the tab bar (the rest goes in "More").
 */
const meta = {
  title: "Layout/App shell",
  component: Frame,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Frame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

/** Between 768 and 1024 px: the narrow sidebar, icons only (their names still said). */
export const Narrow: Story = {
  globals: { viewport: { value: "tablet", isRotated: false } },
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

/** A sentence under the title, about the whole screen. */
export const WithDescription: Story = {
  render: () => (
    <Page
      title="Monthly review"
      description="Made-up data: every account, line and amount here is invented."
    >
      <ScreenBlock>
        <EmptyState
          title="Nothing to show yet"
          description="Import your bank statements: what fills this screen will show here."
        />
      </ScreenBlock>
    </Page>
  ),
};

/** A screen in sections, like the settings, with its blocks under their headings. */
export const Sections: Story = {
  render: () => (
    <Page title="Settings">
      <SectionLayout
        label="Settings"
        navigation={
          <>
            <SectionLink href="#general" label="General" aria-current="page" />
            <SectionLink href="#categories" label="Categories" />
            <SectionLink href="#rules" label="Rules" />
          </>
        }
      >
        <Block title="Language" description="The language of the interface on this device.">
          <p className="text-sm">English</p>
        </Block>
      </SectionLayout>
    </Page>
  ),
};

/** Creating a user: a button beside the list's title, opening the form in a dialog. */
function CreateUser() {
  return (
    <Dialog
      trigger={<Button icon="add">Create a user</Button>}
      title="Create a user"
      description="They will choose their own password at their first sign-in."
      onSubmit={(event) => event.preventDefault()}
      actions={<Button type="submit">Create the user</Button>}
    >
      <TextField label="Name" name="name" autoComplete="off" />
      <TextField label="E-mail" name="email" type="email" autoComplete="off" />
      <TextField
        label="Temporary password"
        name="password"
        type="text"
        autoComplete="off"
        description="8 to 128 characters."
      />
    </Dialog>
  );
}

/**
 * The administrator's section of the settings, as the app composes it: who has an account, and
 * beside the list's title the button that opens creating a user in a dialog (a sheet on a phone).
 * No card alone on the page, no way back of its own: the frame is the way.
 */
export const UsersSection: Story = {
  render: () => (
    <Page title="Settings">
      <SectionLayout
        label="Settings"
        navigation={
          <>
            <SectionLink href="#general" label="General" />
            <SectionLink href="#users" label="Users" aria-current="page" />
            <SectionLink href="#categories" label="Categories" />
            <SectionLink href="#rules" label="Rules" />
          </>
        }
      >
        <Block
          title="Users"
          description="Everyone with an account on this installation."
          actions={<CreateUser />}
        >
          <List label="Users">
            <ListItem title="Ada Example" description="ada@example.com" tags={["Administrator"]} />
            <ListItem
              title="Grace Example"
              description="grace@example.com"
              tags={["Temporary password"]}
            />
            <ListItem title="Alan Example" description="alan@example.com" />
          </List>
        </Block>
      </SectionLayout>
    </Page>
  ),
};
