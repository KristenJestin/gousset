import { m } from "@gousset/i18n/messages";
import { Dialog } from "@gousset/ui/components/dialog";
import { ShortcutList } from "@gousset/ui/components/shortcut-list";
import {
  HotkeysProvider,
  defineAppHotkeys,
  useAppHotkeyList,
  useFormatForDisplay,
  useHotkey,
} from "@tanstack/react-hotkeys";
import type { CustomHotkeys } from "@tanstack/react-hotkeys";
import { createContext, use, useState } from "react";
import type { ReactNode } from "react";

import { isCharacterKeyShortcut } from "./lib/character-keys";

/**
 * Every shortcut of the app, declared once: the `?` list is built from here, and the user's
 * rebinding (later) is keyed by these ids, which therefore never change. Each id has its label in
 * `hotkeyLabels`.
 */
export const appHotkeys = defineAppHotkeys({
  "shortcuts.show": { hotkey: "?", meta: { name: "Show keyboard shortcuts" } },
  // The same list behind a modifier, for whoever turned the single-key shortcuts off.
  "shortcuts.showWithModifier": { hotkey: "Mod+/", meta: { name: "Show keyboard shortcuts" } },
  "search.open": { hotkey: "Mod+K", meta: { name: "Search" } },
});

declare module "@tanstack/react-hotkeys" {
  interface Register {
    appHotkeys: typeof appHotkeys;
  }
}

/** Each shortcut's label in the messages, by its id. */
const hotkeyLabels = {
  "shortcuts.show": m.shortcutShow,
  "shortcuts.showWithModifier": m.shortcutShow,
  "search.open": m.shortcutSearch,
} satisfies { [id in keyof typeof appHotkeys]: () => string };

/**
 * The app with its single-key shortcuts off (WCAG 2.2, 2.1.4 Character Key Shortcuts): each app
 * hotkey made of characters alone is unbound, so it neither fires nor shows in the list.
 */
const WITHOUT_SINGLE_KEYS: CustomHotkeys<typeof appHotkeys> = {};

for (const appHotkey of Object.values(appHotkeys)) {
  if (isCharacterKeyShortcut(appHotkey.defaultHotkey)) {
    WITHOUT_SINGLE_KEYS[appHotkey.id] = null;
  }
}

/** Opens the list of shortcuts, for a menu that offers it. */
const ShowShortcutsContext = createContext<() => void>(() => undefined);

/** What opens the list of shortcuts from a menu or a button: the user's menu offers it. */
export function useShowShortcuts(): () => void {
  return use(ShowShortcutsContext);
}

/** The dialogs the global shortcuts open; one at a time. */
type Open = "shortcuts" | "search" | null;

type ShortcutsProps = {
  /** The user's setting: whether the shortcuts made of one character fire. On when signed out. */
  singleKeyShortcuts: boolean;
  children: ReactNode;
};

/**
 * The app-wide shortcuts, around the app: their declarations, the user's setting, and the dialogs
 * they open (the shortcuts list, and the search).
 */
export function Shortcuts({ singleKeyShortcuts, children }: ShortcutsProps) {
  return (
    <HotkeysProvider
      appHotkeys={appHotkeys}
      customHotkeys={singleKeyShortcuts ? null : WITHOUT_SINGLE_KEYS}
    >
      <ShortcutDialogs>{children}</ShortcutDialogs>
    </HotkeysProvider>
  );
}

function ShortcutDialogs({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const formatForDisplay = useFormatForDisplay();

  // An unbound shortcut does nothing: the list leaves it out.
  const shortcuts = useAppHotkeyList().flatMap(({ appHotkey }) =>
    appHotkey.hotkey === null
      ? []
      : [
          {
            id: appHotkey.id,
            label: hotkeyLabels[appHotkey.id](),
            keys: formatForDisplay(appHotkey.hotkey),
          },
        ],
  );

  const showShortcuts = () => setOpen("shortcuts");

  useHotkey(appHotkeys["shortcuts.show"], showShortcuts);
  useHotkey(appHotkeys["shortcuts.showWithModifier"], showShortcuts);
  useHotkey(appHotkeys["search.open"], () => setOpen("search"));

  // A dialog closing closes only itself: a late close of one must not close the other, opened
  // since by its own shortcut.
  const follow = (dialog: Exclude<Open, null>) => (next: boolean) => {
    setOpen((current) => {
      if (next) {
        return dialog;
      }

      return current === dialog ? null : current;
    });
  };

  return (
    <ShowShortcutsContext value={showShortcuts}>
      {children}
      <Dialog
        open={open === "shortcuts"}
        onOpenChange={follow("shortcuts")}
        title={m.shortcutsTitle()}
      >
        <ShortcutList shortcuts={shortcuts} />
      </Dialog>
      <Dialog
        open={open === "search"}
        onOpenChange={follow("search")}
        title={m.searchTitle()}
        description={m.searchEmpty()}
      />
    </ShowShortcutsContext>
  );
}
