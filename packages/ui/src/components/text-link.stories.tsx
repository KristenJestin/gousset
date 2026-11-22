import type { Meta, StoryObj } from "@storybook/react-vite";

import { TextLink } from "./text-link";

/**
 * A link, inside text or in a row of actions. The app turns it into a router link, so that it
 * navigates without reloading the page. Its focus ring shows on keyboard focus.
 *
 * Motion: none.
 *
 * Don't: use it for an action that changes something (that is a `Button`), or restyle it as a
 * button.
 */
const meta = {
  title: "Actions/TextLink",
  component: TextLink,
  args: { href: "#", children: "Change password" },
} satisfies Meta<typeof TextLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Inside a sentence. */
export const InText: Story = {
  render: (args) => (
    <p className="text-sm text-muted-foreground">
      Forgot it? <TextLink {...args} /> from the account page.
    </p>
  ),
};

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
