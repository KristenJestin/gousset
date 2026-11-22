import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkbox } from "./checkbox";

/**
 * A choice to tick, on ui-sdk's `Checkbox`, its label beside it: pressing the label ticks it
 * too, and Space does from the keyboard. It submits its `value` (or "on") while ticked.
 *
 * Motion: the box fills in 150 ms and the check scales and fades in (150 ms, ease-out), and out
 * the same way; cut under reduced motion.
 *
 * Don't: use it for a setting that takes effect at once (that is `Switch`), write a label in the
 * negative ("Don't send…"), or restyle it in a page.
 */
const meta = {
  title: "Forms/Checkbox",
  component: Checkbox,
  args: { label: "Count this transfer as savings", name: "savings" },
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const WithDescription: Story = {
  args: { description: "It moves from “spent” to “set aside” in the month." },
};

/** Required: the form cannot be sent until it is ticked. */
export const Required: Story = {
  args: { label: "I made up every figure in this file", required: true },
};

export const Error: Story = {
  args: {
    label: "I made up every figure in this file",
    error: "Tick this box to import the file.",
  },
};

export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "It moves from “spent” to “set aside” in the month." },
};
