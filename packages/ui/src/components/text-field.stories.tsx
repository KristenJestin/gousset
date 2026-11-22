import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextField } from "./text-field";

/**
 * A labelled text input, on ui-sdk's `Field` and `Input`: names, e-mails, passwords. The label,
 * the help line and the error are linked to the input (`aria-labelledby`, `aria-describedby`,
 * `aria-invalid`). Without an `error`, the browser's own checks (`required`, `type="email"`)
 * show their message under the input once a submit fails.
 *
 * Motion: the border changes colour in 150 ms (invalid, focus); cut under reduced motion.
 *
 * Don't: use the placeholder as the label, restyle it in a page, or write an error that does not
 * say how to fix it. Every other form control (Select, Combobox, Checkbox, Switch, DatePicker)
 * shares this field: same label, help and error.
 */
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

/** A line of help under the input, read with it by screen readers. */
export const WithDescription: Story = {
  args: { description: "Only used to sign in; never shown to anyone." },
};

/** Required: a star after the label, hidden from screen readers, which hear `required`. */
export const Required: Story = { args: { required: true } };

/** An error from the page or the server: the input is invalid and the message is linked to it. */
export const Error: Story = {
  args: {
    defaultValue: "ada@",
    description: "Only used to sign in.",
    error: "Enter an e-mail address like ada@example.com.",
  },
};

export const Disabled: Story = { args: { disabled: true, defaultValue: "ada@example.com" } };

/** The label hidden where the layout says it already; it still names the input. */
export const HiddenLabel: Story = {
  args: { label: "Search transactions", hideLabel: true, type: "search", placeholder: "Search…" },
};

/** `sm`, the height of a small button, in dense rows and toolbars. */
export const Small: Story = { args: { size: "sm" } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "Only used to sign in.", required: true },
};
