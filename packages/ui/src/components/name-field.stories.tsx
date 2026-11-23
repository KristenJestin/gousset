import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { NameField } from "./name-field";
import type { NameFieldProps } from "./name-field";

const MERCHANTS = ["Greenmarket", "Greenway Bakery", "Harbor Books", "Streamly", "Riverside Cafe"];

/** The field with its own state, as a page holds it. */
function Controlled(props: Omit<NameFieldProps, "value" | "onValueChange"> & { initial?: string }) {
  const { initial = "", ...field } = props;
  const [value, setValue] = useState(initial);

  return <NameField {...field} value={value} onValueChange={setValue} />;
}

/**
 * A name typed freely, with the existing names offered as the user types (a merchant to move a
 * label to, or to merge into), on ui-sdk's `Autocomplete`. Choosing a suggestion writes it in the
 * field; a name no suggestion has is kept as typed. The suggestions that show are those that
 * contain the text, any case.
 *
 * Motion: the suggestions fade in with a slight scale from the field (150 ms, ease-out) and leave
 * the same way; cut under reduced motion.
 *
 * Don't: use it where the value must be one of the items (that is `Combobox`), or restyle it in a
 * page.
 */
const meta = {
  title: "Forms/NameField",
  component: Controlled,
  args: {
    label: "Merchant",
    name: "merchant",
    suggestions: MERCHANTS,
    placeholder: "A merchant's name",
  },
} satisfies Meta<typeof Controlled>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A name already typed. */
export const Typed: Story = { args: { initial: "Greenmarket" } };

export const WithDescription: Story = {
  args: { description: "An existing merchant, or a new name to make one." },
};

export const Error: Story = {
  args: { initial: "", error: "Give the merchant a name." },
};

export const Disabled: Story = { args: { disabled: true, initial: "Harbor Books" } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { description: "An existing merchant, or a new name to make one." },
};
