import type { Meta, StoryObj } from "@storybook/react-vite";

import { CATEGORIES } from "../stories/made-up";
import { Combobox } from "./combobox";

const categories = CATEGORIES.map((category) => ({
  value: category.id,
  label: category.name,
  icon: category.icon,
}));

/**
 * One choice among a long list, found by typing, on ui-sdk's `Combobox`. Typing filters the list
 * (case and accents ignored) and highlights the first match; Enter chooses it. When nothing
 * matches, the list says so, and screen readers hear the count of results once typing pauses.
 * The value is always one of the items: closing without choosing puts the chosen label back.
 *
 * Motion: the list fades in with a slight scale from the input (150 ms, ease-out) and leaves the
 * same way; cut under reduced motion.
 *
 * Don't: use it for a free text with suggestions (the value must be an item), for a handful of
 * items (that is `Select`), or restyle it in a page.
 */
const meta = {
  title: "Forms/Combobox",
  component: Combobox,
  args: {
    label: "Category",
    name: "category",
    items: categories,
    placeholder: "Search a category",
  },
} satisfies Meta<typeof Combobox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A value chosen: its label in the input, its icon before it. */
export const Chosen: Story = { args: { defaultValue: "subscriptions" } };

export const WithDescription: Story = {
  args: { description: "Type a few letters to find it." },
};

export const Required: Story = { args: { required: true } };

export const Error: Story = { args: { error: "Choose a category for this expense." } };

export const Disabled: Story = { args: { disabled: true, defaultValue: "health" } };

export const Small: Story = { args: { size: "sm" } };

/** Its choice being saved by the page (#238): busy, the loader in place of its chevron. */
export const Pending: Story = { args: { defaultValue: "subscriptions", pending: true } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "Type a few letters to find it." },
};
