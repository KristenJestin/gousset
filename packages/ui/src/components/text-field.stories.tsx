import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextField } from "./text-field";

/** A labelled input. Always give it a label; a placeholder is not one. */
const meta = {
  title: "Forms/TextField",
  component: TextField,
  args: { label: "E-mail", name: "email", type: "email", autoComplete: "email" },
} satisfies Meta<typeof TextField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = { args: { defaultValue: "ada@example.com" } };

export const Password: Story = {
  args: { label: "Password", name: "password", type: "password", autoComplete: "current-password" },
};

export const Disabled: Story = { args: { disabled: true, defaultValue: "ada@example.com" } };
