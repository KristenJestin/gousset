import type { Meta, StoryObj } from "@storybook/react-vite";

import { Switch } from "./switch";

/**
 * A setting that takes effect as soon as it changes, on ui-sdk's `Switch` (the `switch` role). The
 * label says what the setting is and stays the same on and off; the switch sits at the end of the
 * line. Space toggles it; Enter submits its form and never toggles it.
 *
 * Motion: the thumb slides and the track fills in 150 ms (ease-out); cut under reduced motion.
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

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "Amounts show as dots until you hover them." },
};
