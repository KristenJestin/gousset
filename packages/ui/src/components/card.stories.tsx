import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "./card";

/** A block on the page, one step above the background. Don't put a card inside a card. */
const meta = {
  title: "Layout/Card",
  component: Card,
  args: {
    title: "Sign in",
    description: "Sign in with the e-mail and password of your account.",
    children: "Content",
  },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithDescription: Story = {};

export const TitleOnly: Story = { args: { description: undefined } };
