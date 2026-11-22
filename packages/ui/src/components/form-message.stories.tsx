import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./button";
import { FormMessage } from "./form-message";

/**
 * A form's error. It fades in and out in 200 ms, and does not move under reduced motion. Its line
 * is always reserved, so the form does not jump; don't hide it with a condition in the page, pass
 * `undefined` instead.
 */
const meta = {
  title: "Forms/FormMessage",
  component: FormMessage,
  args: { message: "Wrong e-mail or password." },
} satisfies Meta<typeof FormMessage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Shown: Story = {};

export const Hidden: Story = { args: { message: undefined } };

/** Toggle it to see the fade. */
export const Fading: Story = {
  render: function Fading(args) {
    const [shown, setShown] = useState(true);

    return (
      <div className="flex flex-col gap-2">
        <FormMessage message={shown ? args.message : undefined} />
        <Button variant="secondary" onClick={() => setShown(!shown)}>
          Toggle
        </Button>
      </div>
    );
  },
};
