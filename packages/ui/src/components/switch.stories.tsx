import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Switch } from "./switch";

/**
 * Saved for as long as asked from each change, as a page saves it: the new value at once, pending
 * until the save ends. The loader shows only once the save has lasted 300 ms.
 */
function SavedIn({ milliseconds }: { milliseconds: number }) {
  const [kept, setKept] = useState(false);
  const [saving, setSaving] = useState<boolean>();

  return (
    <Switch
      label="Hide amounts on screen"
      checked={saving ?? kept}
      pending={saving !== undefined}
      onCheckedChange={(next) => {
        if (saving !== undefined) {
          return;
        }

        setSaving(next);
        setTimeout(() => {
          setKept(next);
          setSaving(undefined);
        }, milliseconds);
      }}
    />
  );
}

/**
 * A setting that takes effect as soon as it changes, on ui-sdk's `Switch` (the `switch` role). The
 * label says what the setting is and stays the same on and off; the switch sits at the end of the
 * line. Space toggles it; Enter submits its form and never toggles it. Saved by the page, it moves
 * at once and is `pending` until the save ends (`aria-busy`): a save that lasts shows the loader in
 * its thumb; a refused one goes back, and the page says why.
 *
 * Motion: the thumb slides and the track fills in 150 ms (ease-out); cut under reduced motion. The
 * loader in the thumb shows after 300 ms, stays at least 500 ms, and only pulses under reduced
 * motion (`Loader`).
 *
 * Don't: use it for a choice that waits for a Save button (that is `Checkbox`), change its label
 * with its state ("On"/"Off"), or restyle it in a page.
 */
const meta = {
  title: "Forms/Switch",
  component: Switch,
  args: { label: "Hide amounts on screen", name: "hide-amounts" },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = { args: { defaultChecked: true } };

export const WithDescription: Story = {
  args: { description: "Amounts show as dots until you hover them." },
};

export const Error: Story = {
  args: {
    label: "Weekly summary by e-mail",
    error: "Add an e-mail address to your account first.",
  },
};

export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };

/** Turned on, its save still running: the loader in the thumb. */
export const Pending: Story = { args: { checked: true, pending: true } };

/** Turned off, its save still running. */
export const PendingOff: Story = { args: { checked: false, pending: true } };

/** A save of 1.5 s from each change: pending throughout, the loader from 300 ms. */
export const SlowSave: Story = { render: () => <SavedIn milliseconds={1500} /> };

/** A save of 100 ms: pending, but too short for the loader to show. */
export const FastSave: Story = { render: () => <SavedIn milliseconds={100} /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "Amounts show as dots until you hover them." },
};
