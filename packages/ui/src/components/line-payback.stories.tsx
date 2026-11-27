import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { LinePayback } from "./line-payback";
import { TextLink } from "./text-link";

/**
 * A line that pays a subject back (#217), in its detail where a transfer would be: "Pays back" and
 * the subject, a link to its page, and that it is not income. It is detached from the subject's
 * page.
 *
 * Motion: none of its own.
 *
 * Don't: offer a category for it: it is classified by its subject.
 */
const meta = {
  title: "Operations/LinePayback",
  component: LinePayback,
  args: { subject: <TextLink href="#lyon">Lyon trip</TextLink> },
} satisfies Meta<typeof LinePayback>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const French: Story = {
  render: (args) => (
    <InFrench>
      <LinePayback {...args} />
    </InFrench>
  ),
};
