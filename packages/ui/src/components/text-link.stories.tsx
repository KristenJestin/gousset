import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextLink } from "./text-link";

/** A link. For an action that changes something, use a `Button`. */
const meta = {
  title: "Actions/TextLink",
  component: TextLink,
  args: { href: "#", children: "Change password" },
} satisfies Meta<typeof TextLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
