import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Card } from "./card";
import { EmptyState } from "./empty-state";

/**
 * What a block shows when it has nothing to show: an icon (`empty` by default), a title in the
 * page's words, one line of help and at most one action. `block` fills a block, centred;
 * `compact` is one row, for a list or a small block. It draws no block of its own.
 *
 * Motion: none of its own; its action is a `Button` (colours in 150 ms, a slight press), cut
 * under reduced motion.
 *
 * Don't: put it in a block of its own (no block in a block), draw an illustration, use it for an
 * error (that is `ErrorState`), or for data on its way (that is the block's skeleton).
 */
const meta = {
  title: "States/EmptyState",
  component: EmptyState,
  args: {
    title: "No lines this month",
    description: "Import a statement to see where the money went.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With its one action; pressing it here says it ran. */
export const WithAction: Story = {
  render: function WithAction(args) {
    const [imported, setImported] = useState(false);

    return (
      <div className="flex flex-col gap-2">
        <EmptyState
          {...args}
          action={{ label: "Import statements", icon: "import", onClick: () => setImported(true) }}
        />
        <p role="status" className="text-sm text-muted-foreground">
          {imported ? "Import started" : ""}
        </p>
      </div>
    );
  },
};

/** A telling icon instead of the inbox. */
export const OtherIcon: Story = {
  args: {
    icon: "search",
    title: "No line matches",
    description: "Try fewer words, or another month.",
  },
};

/** One row, for a list or a small block. */
export const Compact: Story = {
  args: {
    size: "compact",
    title: "No subscription found",
    description: "They show up after two months of the same payment.",
  },
};

export const CompactWithAction: Story = {
  args: {
    size: "compact",
    title: "No rule yet",
    action: { label: "Add a rule", icon: "add", onClick: () => undefined },
  },
};

/** Where it lives: inside a block, which keeps its title. */
export const InABlock: Story = {
  render: (args) => (
    <Card title="October 2026">
      <EmptyState
        {...args}
        action={{ label: "Import statements", icon: "import", onClick: () => undefined }}
      />
    </Card>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => (
    <Card title="October 2026">
      <EmptyState
        {...args}
        action={{ label: "Import statements", icon: "import", onClick: () => undefined }}
      />
    </Card>
  ),
};
