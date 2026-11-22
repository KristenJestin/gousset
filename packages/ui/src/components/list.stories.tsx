import type { Meta, StoryObj } from "@storybook/react-vite";

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

export const Empty: Story = { args: { children: null } };
