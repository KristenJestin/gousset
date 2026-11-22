import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusMessage } from "./status-message";

/**
 * A short confirmation after an action, announced to screen readers. For an error, use
 * `FormMessage`.
 *
 * Motion: none; the text appears in its line.
 *
 * Don't: render it only once there is a message (without a message its live region stays in the
 * page, empty and hidden, so that the message is announced when it comes), or use it for
 * something that should survive leaving the page (that is a toast).
 */
const meta = {
  title: "Forms/StatusMessage",
  component: StatusMessage,
  args: { message: "Robin Example can now sign in with the temporary password." },
} satisfies Meta<typeof StatusMessage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Shown: Story = {};

export const Empty: Story = { args: { message: undefined } };

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
