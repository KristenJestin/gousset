import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { SubjectMerchants } from "./subject-merchants";

/**
 * What attaches a subject's expenses on its own (docs/wireframes, screen 5, block 4): the merchants
 * whose expenses land in it, one chip each, each a rule "merchant is"; then how many other rules
 * attach it. A sentence when nothing does.
 *
 * Don't: make the chips buttons: the merchants are changed in the subject's sheet.
 */
const meta = {
  title: "Subjects/SubjectMerchants",
  component: SubjectMerchants,
  args: { merchants: ["Fuelstop", "Shieldline", "Northway tolls"], otherRules: 0 },
} satisfies Meta<typeof SubjectMerchants>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Merchants, and a rule of another kind (a label, an amount) attaching it too. */
export const WithOtherRules: Story = { args: { otherRules: 2 } };

export const Nothing: Story = { args: { merchants: [], otherRules: 0 } };

export const French: Story = {
  args: { otherRules: 1 },
  render: (args) => (
    <InFrench>
      <SubjectMerchants {...args} />
    </InFrench>
  ),
};
