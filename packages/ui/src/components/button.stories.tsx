import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./button";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Loading for as long as asked, from a click: the loader appears only after 300 ms. */
function LoadingFor({ milliseconds }: { milliseconds: number }) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      icon="import"
      loading={loading}
      loadingLabel="Importing…"
      onClick={() => {
        setLoading(true);
        setTimeout(() => setLoading(false), milliseconds);
      }}
    >
      Import statements
    </Button>
  );
}

/**
 * A button, on ui-sdk's `Button`. `primary` for the one action of a form or a screen,
 * `secondary` for the others, `ghost` in toolbars and rows, `quiet` for a way back beside the way
 * forward (undo an import: red only on hover), `destructive` for what deletes.
 *
 * Loading: the loader takes the place of the icon (or of the label, without an icon), the button
 * keeps its width, is disabled and `aria-busy`, and its label may change. It shows only after
 * about 300 ms and then stays at least 500 ms. A `onClick` returning a promise does the same.
 *
 * Motion: colours change in 150 ms on hover; it presses in slightly (scale 0.97). Cut under
 * reduced motion.
 *
 * Don't: put two primary buttons side by side, restyle it in a page, or draw an icon-only button
 * with it (that is `IconButton`, which requires a label).
 */
const meta = {
  title: "Actions/Button",
  component: Button,
  args: { children: "Save" },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: "secondary", children: "Cancel" } };

export const Ghost: Story = { args: { variant: "ghost", children: "Edit" } };

export const Destructive: Story = { args: { variant: "destructive", children: "Delete" } };

/** A way back beside the way forward: no surface, set apart from the primary; red on hover. */
export const Quiet: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="quiet" size="sm" icon="undo">
        Undo this import
      </Button>
      <Button size="sm">Continue to the review</Button>
    </div>
  ),
};

export const WithIcon: Story = { args: { icon: "import", children: "Import statements" } };

export const Small: Story = { args: { size: "sm", icon: "check", children: "Approve" } };

/** Every variant side by side, normal and disabled. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((disabled) => (
        <div key={String(disabled)} className="flex flex-wrap gap-3">
          <Button disabled={disabled}>Primary</Button>
          <Button variant="secondary" disabled={disabled}>
            Secondary
          </Button>
          <Button variant="ghost" disabled={disabled}>
            Ghost
          </Button>
          <Button variant="destructive" disabled={disabled}>
            Destructive
          </Button>
        </div>
      ))}
    </div>
  ),
};

/** Loading with an icon: the loader takes the icon's place, the label says what runs. */
export const Loading: Story = {
  args: { icon: "import", loading: true, loadingLabel: "Importing…", children: "Import" },
};

/** Loading without an icon: the loader takes the label's place; the width stays. */
export const LoadingWithoutIcon: Story = { args: { loading: true } };

/** Small and loading: the loader at 14 px. */
export const LoadingSmall: Story = {
  args: { size: "sm", icon: "check", loading: true, children: "Approve" },
};

/** Click: nothing shows for 300 ms, then the loader stays at least 500 ms. */
export const LoadingFromClick: Story = { render: () => <LoadingFor milliseconds={1500} /> };

/** A fast action (100 ms) shows no loader at all. */
export const FastAction: Story = { render: () => <LoadingFor milliseconds={100} /> };

/** `onClick` returns a promise: pending until it settles, the same loader. */
export const PendingPromise: Story = {
  args: { icon: "check", children: "Approve", onClick: () => wait(1500) },
};

export const Disabled: Story = { args: { disabled: true } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="flex flex-col gap-3">
      <Button icon="import">Import statements</Button>
      <Button variant="secondary">Cancel</Button>
    </div>
  ),
};
