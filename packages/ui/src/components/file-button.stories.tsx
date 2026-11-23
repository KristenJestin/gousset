import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { FileButton } from "./file-button";
import type { FileButtonProps } from "./file-button";

/** Says which file the last pick handed over, so a test can read it. */
function Receiving({ props }: { props: FileButtonProps }) {
  const [received, setReceived] = useState<string>();

  return (
    <div className="flex flex-col items-start gap-3">
      <FileButton {...props} onFile={(file) => setReceived(file.name)} />
      <p role="status" data-testid="received" className="text-sm text-muted-foreground">
        {received ?? "Nothing received yet."}
      </p>
    </div>
  );
}

/**
 * A button that opens the file picker for one file: a profile to import on the import screen's
 * CSV preview. `onFile` is called with the file chosen, and again when the same one is chosen
 * again. The page writes the label and the filter.
 *
 * Motion: `Button`'s own (colours in 150 ms, a slight press); cut under reduced motion.
 *
 * Don't: use it for statements, which come in by `FileDrop`, several at a time.
 */
const meta = {
  title: "Forms/File button",
  component: FileButton,
  args: {
    children: "Import a profile file",
    accept: ".json,application/json",
    icon: "import",
    onFile: () => undefined,
  },
  render: (args) => <Receiving props={args} />,
} satisfies Meta<typeof FileButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Waiting for a file. */
export const Default: Story = {};

/** While the file chosen is being read: disabled, its loader in the icon's place. */
export const Loading: Story = { args: { loading: true } };

/** Nothing to import here yet. */
export const Disabled: Story = { args: { disabled: true } };
