import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { ListSkeleton } from "./list";

/**
 * A block on the page (docs/design.md, "Surfaces"): one step above the background, a border and
 * no shadow, 12 px corners, a title and a line saying what it is for. Its title and description
 * never load: while its content comes, the content's own skeleton sits inside it (a
 * `ListSkeleton`…); with nothing to show, an `EmptyState`; when it failed, an `ErrorState`, and
 * the blocks beside it keep working.
 *
 * Motion: none of its own.
 *
 * Don't: put a card inside a card, add a shadow to it, or restyle it in a page.
 */
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

/** Its content on its way: the content's skeleton, inside the card. */
export const Loading: Story = {
  args: { title: "Users", description: "Who has an account here.", children: <ListSkeleton /> },
};

export const Empty: Story = {
  args: {
    title: "Users",
    description: "Who has an account here.",
    children: <EmptyState title="Nobody else yet" />,
  },
};

export const Failed: Story = {
  args: {
    title: "Users",
    description: "Who has an account here.",
    children: <ErrorState onRetry={() => undefined} />,
  },
};

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
