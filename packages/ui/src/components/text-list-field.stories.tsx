import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { TextListField } from "./text-list-field";
import type { TextListFieldProps } from "./text-list-field";

/**
 * The field inside a form, as a page holds it: the list it reports and whether the form was sent
 * are written out, so a test can read both.
 */
function Holding({ props }: { props: TextListFieldProps }) {
  const [values, setValues] = useState(props.values);
  const [sent, setSent] = useState(0);

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSent((count) => count + 1);
      }}
    >
      <TextListField {...props} values={values} onChange={setValues} />
      <Button type="submit">Save</Button>
      <p data-testid="reported" className="text-sm text-muted-foreground">
        {`${values.join(" | ") || "No label"} · sent ${String(sent)} times`}
      </p>
    </form>
  );
}

/**
 * A list of short texts, each a chip with its own remove button ("Remove CB GREENMARKET"), then
 * an input and "Add": the cleaned labels that name a merchant. Enter in the input adds its text
 * and never sends the form around it. A text is trimmed, an empty one ignored, one already listed
 * kept once; once a chip is removed the keyboard goes on from the input. Long texts are cut with
 * an ellipsis; on a phone the chips wrap.
 *
 * Motion: none of its own; the buttons' own (colours in 150 ms, a slight press), cut under
 * reduced motion.
 *
 * Don't: use it for a choice among known values (a `Select` or a `Combobox` is that), or remove a
 * text the server needs another action for.
 */
const meta = {
  title: "Forms/TextListField",
  component: TextListField,
  args: {
    label: "Labels",
    values: ["CB GREENMARKET", "MEALCARD GREENMARKET"],
    description: "The cleaned labels of the lines this merchant names.",
    placeholder: "CB GREENMARKET",
    onChange: () => undefined,
  },
  render: (args) => <Holding props={args} />,
} satisfies Meta<typeof TextListField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No text yet: the input alone. */
export const Empty: Story = { args: { values: [] } };

/** A text the server would not take: why, under the field. */
export const Refused: Story = {
  args: { error: "“MEALCARD GREENMARKET” already names Fuelstop: move it from there instead." },
};

/** A long text, cut with an ellipsis in its chip. */
export const LongText: Story = {
  args: {
    values: ["PRLV SEPA HARBOR SAVINGS LOAN MONTHLY INSTALMENT REF 2026-10 RIVERTON BRANCH"],
  },
};

/** While the form is sent. */
export const Disabled: Story = { args: { disabled: true } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { values: ["CB GREENMARKET", "MEALCARD GREENMARKET", "PAYLINK GREENMARKET"] },
};

/** On a French page: "Ajouter", and each chip's "Retirer". */
export const French: Story = {
  args: { label: "Libellés", description: "Les libellés nettoyés des lignes qu'il nomme." },
  render: (args) => (
    <InFrench>
      <Holding props={args} />
    </InFrench>
  ),
};
