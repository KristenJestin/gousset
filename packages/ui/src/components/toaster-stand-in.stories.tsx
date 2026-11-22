import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@gousset/ui/components/button";
import { Toaster } from "@gousset/ui/components/toaster-stand-in";
import { notify } from "@gousset/ui/lib/notify-stand-in";

/**
 * Where a page tells the user something happened: `notify.failed({ description, retry })` from
 * anywhere, one `Toaster` per page. An error stays until dismissed and is announced at once
 * (`role="alert"`).
 *
 * Motion: none; the toaster of the shared components (#7) replaces this stand-in.
 *
 * Don't: write a toast's text in a component; it comes from the messages.
 */
const meta = {
  title: "Feedback/Toaster (stand-in)",
  component: Toaster,
  render: () => (
    <>
      <Button
        variant="secondary"
        onClick={() =>
          notify.failed({
            description: "The line could not be approved; it is back in the list.",
            retry: () => {},
          })
        }
      >
        Refuse an approval
      </Button>
      <Toaster />
    </>
  ),
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Failed: Story = {};
