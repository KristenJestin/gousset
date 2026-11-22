import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";

/**
 * A button. `primary` for the one action of a form or a screen, `secondary` for the others.
 * Don't put two primary buttons side by side, and don't restyle it in a page.
 */
const meta = {
  title: "Actions/Button",
  component: Button,
  args: { children: "Sign in" },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: "secondary", children: "Cancel" } };

/** While its action runs: disabled and `aria-busy`. */
export const Loading: Story = { args: { loading: true } };

export const Disabled: Story = { args: { disabled: true } };
