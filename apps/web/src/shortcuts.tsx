import { m } from "@gousset/i18n/messages";
import { Dialog } from "@gousset/ui/components/dialog";
import { ShortcutList } from "@gousset/ui/components/shortcut-list";
import {
  defineAppHotkeys,
  useAppHotkeyList,
  useFormatForDisplay,
  useHotkey,
} from "@tanstack/react-hotkeys";
import { useState } from "react";

/**
 * Every shortcut of the app, declared once: the `?` list is built from here, and the user's
 * rebinding (later) is keyed by these ids, which therefore never change. Each id has its label in
 * `hotkeyLabels`.
 */
export const appHotkeys = defineAppHotkeys({
  "shortcuts.show": { hotkey: "?", meta: { name: "Show keyboard shortcuts" } },
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
  "search.open": m.shortcutSearch,
} satisfies { [id in keyof typeof appHotkeys]: () => string };

/** The dialogs the global shortcuts open; one at a time. */
type Open = "shortcuts" | "search" | null;

/** The app-wide shortcuts and the dialogs they open: the shortcuts list, and the search. */
export function Shortcuts() {
  const [open, setOpen] = useState<Open>(null);
  const formatForDisplay = useFormatForDisplay();

  const shortcuts = useAppHotkeyList().map(({ appHotkey }) => ({
    id: appHotkey.id,
    label: hotkeyLabels[appHotkey.id](),
    keys: appHotkey.hotkey === null ? "" : formatForDisplay(appHotkey.hotkey),
  }));

  useHotkey(appHotkeys["shortcuts.show"], () => setOpen("shortcuts"));
  useHotkey(appHotkeys["search.open"], () => setOpen("search"));

  const close = () => setOpen(null);

  return (
    <>
      <Dialog
        open={open === "shortcuts"}
        onClose={close}
        title={m.shortcutsTitle()}
        closeLabel={m.dialogClose()}
      >
        <ShortcutList shortcuts={shortcuts} />
      </Dialog>
      <Dialog
        open={open === "search"}
        onClose={close}
        title={m.searchTitle()}
        description={m.searchEmpty()}
        closeLabel={m.dialogClose()}
      />
    </>
  );
}
