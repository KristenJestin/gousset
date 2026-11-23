import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { SegmentedChoice } from "./segmented-choice";

function Language() {
  const [value, setValue] = useState<"en" | "fr">("en");

  return (
    <SegmentedChoice
      label="Language"
      value={value}
      choices={[
        { value: "en", label: "English" },
        { value: "fr", label: "Français" },
      ]}
      onChange={setValue}
    />
  );
}

/**
 * One choice among two to four, side by side: the language in the settings. Arrow keys move
 * between the choices. Motion: the colours change in 200 ms; cut under reduced motion.
 *
 * Don't: use it for more than four choices (that is a `Select`) or for an action (a `Button`).
 */
const meta = {
  title: "Inputs/Segmented choice",
  component: Language,
} satisfies Meta<typeof Language>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
