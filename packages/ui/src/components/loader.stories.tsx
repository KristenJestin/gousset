import type { Meta, StoryObj } from "@storybook/react-vite";

import { Loader } from "./loader";

/**
 * The one loading indicator for an action or a job (a button that saves, an import reading its
 * file): a coin falling into a pocket. It takes the text's colour and, by default, the text's
 * size (`em`).
 *
 * Motion: the coin falls into the pocket and fades, looping every 1.3 s, in CSS (no script, no
 * inline style). Under reduced motion nothing falls: the coin pulses softly in place.
 *
 * Don't: use it for a block whose data is coming (that is a skeleton), draw another spinner, or
 * show it for a fast action: `Button`'s `loading` waits 300 ms before showing it.
 */
const meta = {
  title: "Foundations/Loader",
  component: Loader,
} satisfies Meta<typeof Loader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { size: "lg" } };

/** Announced on its own when nothing else says the page is busy. */
export const Labelled: Story = { args: { size: "lg", label: "Reading the statement" } };

/**
 * 14 px, in a small button, then 16 and 24 px: the pocket and the coin are thickened at 14 px so
 * they still read, in both schemes.
 */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {(["light", "dark"] as const).map((scheme) => (
        <div
          key={scheme}
          data-color-scheme={scheme}
          className="flex items-end gap-4 rounded-lg bg-card p-4 text-foreground"
        >
          <Loader size="sm" />
          <Loader size="md" />
          <Loader size="lg" />
        </div>
      ))}
    </div>
  ),
};

/** Sized in `em`: it follows the text it sits in, and its colour. */
export const InText: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader /> Reading the statement…
      </p>
      <p className="flex items-center gap-2 text-2xl text-primary">
        <Loader /> Importing
      </p>
    </div>
  ),
};

/** On a phone, nothing changes: it follows its text. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { size: "lg" },
};
