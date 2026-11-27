import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { SubjectTree, SubjectTreeItem, SubjectTreeSkeleton, SubjectsLayout } from "./subject-tree";

/** The made-up tree of screen 5: a house and what is inside it, a van, a trip, a dog. */
function Tree({ current = "van" }: { current?: string }) {
  const rows = [
    { id: "house", name: "House", depth: 0, figure: "€740/month" },
    { id: "shed", name: "Garden shed", depth: 1, figure: "€2,150/month" },
    { id: "kitchen", name: "Kitchen renovation", depth: 1, figure: "3 Mar. – 18 Apr. 2026" },
    { id: "van", name: "Van", depth: 0, figure: "€165/month" },
    { id: "alps", name: "Alps 2028", depth: 0, figure: "3–17 Jul. 2028" },
    { id: "dog", name: "Dog", depth: 0, figure: "€42/month", archived: true },
  ];

  return (
    <SubjectTree
      label="Your subjects"
      action={
        <Button size="sm" icon="add">
          New
        </Button>
      }
    >
      {rows.map((row) => (
        <SubjectTreeItem
          key={row.id}
          href={`#${row.id}`}
          aria-current={row.id === current ? "page" : undefined}
          name={row.name}
          depth={row.depth}
          figure={row.figure}
          archived={row.archived}
        />
      ))}
    </SubjectTree>
  );
}

/**
 * The user's subjects as a tree (docs/wireframes, screen 5, block 1): each a link to its page, a
 * child indented under its parent, its cost per month at the end, or its dates for a dated one
 * ("Alps 2028"); an archived subject is marked, its name greyed. The subject shown is the current
 * link. The "New" button sits beside the heading. On a phone the tree comes first, the page under
 * it (`SubjectsLayout`).
 *
 * Loading: `SubjectTreeSkeleton`, the heading's place and rows of the same height.
 *
 * Motion: a row's background shows on hover in 150 ms; cut under reduced motion.
 *
 * Don't: put a form in the tree; "New" opens the subject's sheet.
 */
const meta = {
  title: "Subjects/SubjectTree",
  component: Tree,
  args: { current: "van" },
} satisfies Meta<typeof Tree>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Beside a subject's page, as the screen lays them out. */
export const InTheScreen: Story = {
  render: (args) => (
    <SubjectsLayout tree={<Tree {...args} />}>
      <section className="rounded-xl border bg-card p-6 text-sm">Van’s page</section>
    </SubjectsLayout>
  ),
};

export const Loading: Story = { render: () => <SubjectTreeSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Tree {...args} />
    </InFrench>
  ),
};

/** A phone: the tree, then the subject's page under it. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => (
    <SubjectsLayout tree={<Tree {...args} />}>
      <section className="rounded-xl border bg-card p-6 text-sm">Van’s page</section>
    </SubjectsLayout>
  ),
};
