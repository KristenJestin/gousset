import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { List, ListItem, ListLinkItem, ListSkeleton } from "./list";

/**
 * A list of people or things, one per row, with short tags (the users of an installation). It
 * sits in a `Card`, which is the block; the list draws no block of its own. While its data comes,
 * `ListSkeleton` takes its place with rows of the same height; with nothing to show, an
 * `EmptyState`; when it failed, an `ErrorState`.
 *
 * Motion: none of its own; its skeleton waits 150 ms, fades in over 200 ms and breathes; cut
 * under reduced motion.
 *
 * Don't: use it for lines of money (they have their own rows, with amounts lined up), put a card
 * in a row, or render an empty list where an `EmptyState` belongs.
 */
const meta = {
  title: "Data/List",
  component: List,
  args: { label: "Users", children: null },
} satisfies Meta<typeof List>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Users: Story = {
  render: (args) => (
    <List label={args.label}>
      <ListItem title="Ada Example" description="ada@example.com" tags={["Administrator"]} />
      <ListItem
        title="Grace Example"
        description="grace@example.com"
        tags={["Temporary password"]}
      />
      <ListItem title="Alan Example" description="alan@example.com" />
    </List>
  ),
};

/** Three rows on their way, each the height of a loaded row. */
export const Loading: Story = { render: () => <ListSkeleton label="Loading the users" /> };

/** The loaded list and its skeleton side by side: the same height. */
export const LoadingBesideLoaded: Story = {
  render: (args) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Users">
        <List label={args.label}>
          <ListItem title="Ada Example" description="ada@example.com" tags={["Administrator"]} />
          <ListItem title="Grace Example" description="grace@example.com" />
          <ListItem title="Alan Example" description="alan@example.com" />
        </List>
      </Card>
      <Card title="Users">
        <ListSkeleton />
      </Card>
    </div>
  ),
};

/** Nothing to list: the block says so, rather than an empty list. */
export const Empty: Story = {
  render: () => (
    <Card title="Users">
      <EmptyState title="Nobody else yet" description="Add the people who share this place." />
    </Card>
  ),
};

export const Failed: Story = {
  render: () => (
    <Card title="Users">
      <ErrorState title="The users could not be loaded" onRetry={() => undefined} />
    </Card>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => (
    <Card title="Users">
      <List label={args.label}>
        <ListItem title="Ada Example" description="ada@example.com" tags={["Administrator"]} />
        <ListItem
          title="Grace Example"
          description="grace@example.com"
          tags={["Temporary password"]}
        />
      </List>
    </Card>
  ),
};

/**
 * Rows that open what they name (a merchant's page): the whole row is the link, a chevron at its
 * end. Its background shows on hover in 150 ms; cut under reduced motion. Not for a row that also
 * has an action of its own.
 */
export const Links: Story = {
  render: () => (
    <Card title="Merchants">
      <List label="Merchants">
        <ListLinkItem href="#greenmarket" title="Greenmarket" description="3 labels" />
        <ListLinkItem href="#harbor-books" title="Harbor Books" description="1 label" />
        <ListLinkItem href="#streamly" title="Streamly" description="2 labels" />
      </List>
    </Card>
  ),
};

/**
 * A row's own action, at its end: one secondary button, named with the row it acts on so that a
 * screen reader reads it alone. Not for several actions per row.
 */
export const WithAction: Story = {
  render: () => (
    <List label="Connected clients">
      <ListItem
        title="Example Agent"
        description="agent.example.com"
        tags={["Read and write"]}
        action={
          <Button variant="secondary" aria-label="Revoke Example Agent">
            Revoke
          </Button>
        }
      />
      <ListItem
        title="Notes Helper"
        description="notes.example.org"
        tags={["Read only"]}
        action={
          <Button variant="secondary" aria-label="Revoke Notes Helper">
            Revoke
          </Button>
        }
      />
    </List>
  ),
};
