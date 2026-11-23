import type { Meta, StoryObj } from "@storybook/react-vite";

import { Chip } from "./chip";

/**
 * A plain pill of words beside a name: an envelope, an institution, a group. No icon, nothing to
 * click.
 *
 * Don't: use it for an account's kind with its icon (that is `AccountChip`), or put a long
 * sentence in it (it truncates, it does not wrap).
 */
const meta = {
  title: "Data/Chip",
  component: Chip,
  args: { children: "PEA" },
} satisfies Meta<typeof Chip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Several: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Chip>PEA</Chip>
      <Chip>Livret A</Chip>
      <Chip>Northbank</Chip>
    </div>
  ),
};

export const LongName: Story = {
  render: () => (
    <div className="w-32">
      <Chip>Works council benefits</Chip>
    </div>
  ),
};
