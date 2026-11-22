import type { Meta, StoryObj } from "@storybook/react-vite";

import { CATEGORIES } from "../stories/made-up";
import { Select } from "./select";

const categories = CATEGORIES.map((category) => ({
  value: category.id,
  label: category.name,
  icon: category.icon,
}));

/**
 * One choice among a short list, on ui-sdk's `Select`: a button with the `combobox` role that
 * opens a `listbox`. Enter, Space or Arrow Down opens it, arrows move, Enter chooses, Escape
 * closes; typing on the closed button picks the next item starting with that letter. Each item
 * may carry an icon, shown in the button once chosen.
 *
 * Motion: the list fades in with a slight scale from the button (150 ms, ease-out) and leaves the
 * same way; cut under reduced motion.
 *
 * Don't: use it for more than a dozen items or for a list the user would rather search (that is
 * `Combobox`), for two choices (a `Switch` or a `Checkbox`), or restyle it in a page.
 */
const meta = {
  title: "Forms/Select",
  component: Select,
  args: {
    label: "Category",
    name: "category",
    items: categories,
    placeholder: "Choose a category",
  },
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A value chosen: its icon and label show in the button. */
export const Chosen: Story = { args: { defaultValue: "groceries" } };

export const WithDescription: Story = {
  args: { description: "Where this expense counts in the month." },
};

export const Required: Story = { args: { required: true } };

/** Items without icons. */
export const PlainItems: Story = {
  args: {
    label: "Sort by",
    placeholder: undefined,
    defaultValue: "date",
    items: [
      { value: "date", label: "Date" },
      { value: "amount", label: "Amount" },
      { value: "merchant", label: "Merchant" },
    ],
  },
};

/** One item cannot be chosen; the keyboard skips it. */
export const DisabledItem: Story = {
  args: {
    items: categories.map((category) => ({ ...category, disabled: category.value === "leisure" })),
  },
};

export const Error: Story = { args: { error: "Choose a category for this expense." } };

export const Disabled: Story = { args: { disabled: true, defaultValue: "housing" } };

export const Small: Story = { args: { size: "sm", defaultValue: "transport" } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { defaultValue: "restaurants", description: "Where this expense counts in the month." },
};
