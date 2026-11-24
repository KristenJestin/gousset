import type { Meta, StoryObj } from "@storybook/react-vite";

import { ButtonLink } from "./button-link";

/**
 * A link that looks like a button: the next step of a task, on another page (an import's
 * "Continue to the review"). It is a link (`<a>`), so it opens in a new tab and says where it
 * goes; the app turns it into a router link. Its look is `Button`'s.
 *
 * Motion: colours change in 150 ms on hover; it presses in slightly (scale 0.97). Cut under
 * reduced motion.
 *
 * Don't: use it for an action that changes something here (that is a `Button`), or inside a
 * sentence (that is a `TextLink`).
 */
const meta = {
  title: "Actions/ButtonLink",
  component: ButtonLink,
  args: { href: "#", children: "Continue to the review", trailingIcon: "next" },
} satisfies Meta<typeof ButtonLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { size: "sm" } };

export const Secondary: Story = { args: { variant: "secondary", trailingIcon: undefined } };
