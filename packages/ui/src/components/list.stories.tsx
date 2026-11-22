import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { List, ListItem } from "./list";

/** A list of people or things, one per row, with short tags. Not for lines of money. */
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

export const Empty: Story = { args: { children: null } };
