import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { IconButton } from "./icon-button";

/** Loading for as long as asked, from a click: the loader appears only after 300 ms. */
function LoadingFor({ milliseconds }: { milliseconds: number }) {
  const [loading, setLoading] = useState(false);

  return (
    <IconButton
      icon="retry"
      label="Refresh the accounts"
      variant="secondary"
      loading={loading}
      onClick={() => {
        setLoading(true);
        setTimeout(() => setLoading(false), milliseconds);
      }}
    />
  );
}

/**
 * A button with only an icon, for toolbars, rows and the month switcher. Its `label` is required:
 * it is the button's accessible name and the text of its tooltip, shown on hover after a short
 * rest and at once on keyboard focus. `ghost` by default, `secondary` beside other buttons; `md`
 * (36 px) and `sm` (32 px) squares, the heights of `Button`.
 *
 * Loading: the loader takes the icon's place after about 300 ms and stays at least 500 ms; the
 * button is disabled and `aria-busy` meanwhile.
 *
 * Motion: colours change in 150 ms on hover and it presses in slightly, as `Button`; the tooltip
 * fades and grows from the button in 150 ms, ease-out. Cut under reduced motion.
 *
 * Don't: use it for an action whose icon is not obvious (a `Button` with a label says more), leave
 * the label vague ("Button", "Icon"), or put two icon buttons with the same label side by side.
 */
const meta = {
  title: "Actions/IconButton",
  component: IconButton,
  args: { icon: "more", label: "More actions" },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ghost: Story = {};

export const Secondary: Story = { args: { variant: "secondary", icon: "add", label: "Add" } };

export const Small: Story = { args: { size: "sm", icon: "close", label: "Remove the filter" } };

/** Every variant and size, normal and disabled. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((disabled) => (
        <div key={String(disabled)} className="flex items-center gap-3">
          <IconButton icon="previous" label="Previous month" disabled={disabled} />
          <IconButton icon="next" label="Next month" disabled={disabled} />
          <IconButton icon="add" label="Add" variant="secondary" disabled={disabled} />
          <IconButton icon="more" label="More actions" size="sm" disabled={disabled} />
          <IconButton
            icon="search"
            label="Search"
            size="sm"
            variant="secondary"
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  ),
};

/** Loading: the loader in the icon's place, the square kept. */
export const Loading: Story = {
  args: { icon: "retry", label: "Refresh the accounts", loading: true, variant: "secondary" },
};

/** Click: nothing shows for 300 ms, then the loader stays at least 500 ms. */
export const LoadingFromClick: Story = { render: () => <LoadingFor milliseconds={1500} /> };

export const Disabled: Story = { args: { disabled: true } };

/** A toolbar: moving along it, the next tooltip opens at once. */
export const Toolbar: Story = {
  render: () => (
    <div role="toolbar" aria-label="Month" className="flex items-center gap-1">
      <IconButton icon="previous" label="Previous month" />
      <IconButton icon="calendar" label="Choose a month" />
      <IconButton icon="next" label="Next month" />
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="flex items-center gap-2">
      <IconButton icon="previous" label="Previous month" />
      <IconButton icon="next" label="Next month" />
      <IconButton icon="more" label="More actions" variant="secondary" />
    </div>
  ),
};
