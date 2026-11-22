import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * A block that failed to load: the error stays in its block, with a button to retry, and the rest
 * of the page keeps working (docs/architecture.md). Its title and message are announced
 * (`role="alert"`); without them it says so in general words, translated. `onRetry` may return a
 * promise: the button is busy, with the loader, until it settles. Sizes match `EmptyState`.
 *
 * Motion: none of its own; the Retry button presses in (150 ms) and shows the loader after
 * 300 ms of a running retry, for at least 500 ms. Cut under reduced motion (the loader pulses).
 *
 * Don't: show a trace or an error code, replace the whole page with it, put it in a block of its
 * own, or leave out the retry.
 */
const meta = {
  title: "States/ErrorState",
  component: ErrorState,
  args: { onRetry: () => wait(1500) },
} satisfies Meta<typeof ErrorState>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The general words, from the ui's messages. */
export const Default: Story = {};

/** The page names what failed and why. */
export const WithMessage: Story = {
  args: {
    title: "The breakdown could not be loaded",
    message: "The server did not answer in time.",
  },
};

export const Compact: Story = {
  args: { size: "compact", title: "Subscriptions could not be loaded" },
};

/** A retry that succeeds after 1.5 s: the block then shows its content. */
export const RetryThenLoaded: Story = {
  render: function RetryThenLoaded() {
    const [failed, setFailed] = useState(true);

    return (
      <Card title="October 2026">
        {failed ? (
          <ErrorState
            onRetry={async () => {
              await wait(1500);
              setFailed(false);
            }}
          />
        ) : (
          <EmptyState title="No lines this month" />
        )}
      </Card>
    );
  },
};

/** One block failed, the one beside it still works. */
export const BesideAWorkingBlock: Story = {
  render: (args) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Breakdown">
        <ErrorState {...args} />
      </Card>
      <Card title="Subscriptions">
        <EmptyState title="No subscription found" size="compact" />
      </Card>
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => (
    <Card title="Breakdown">
      <ErrorState {...args} />
    </Card>
  ),
};
