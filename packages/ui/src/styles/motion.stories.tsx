import type { Meta, StoryObj } from "@storybook/react-vite";
import { motion } from "motion/react";
import { useState } from "react";

import { transition } from "@gousset/ui/lib/motion";

/**
 * The shared motion: one block, always on screen, that fades between full and faint over
 * `transition.slow` (300 ms, ease-out) each time it is toggled. While the system asks for reduced
 * motion it jumps at once, and that follows a change made while the page is open, for this block
 * too: `ThemeProvider` sets Motion's global switch, which Motion reads at each animation.
 */
function MotionSample() {
  const [shown, setShown] = useState(true);

  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <button
        type="button"
        className="rounded-md border bg-card px-3 py-1 text-sm"
        onClick={() => {
          setShown(!shown);
        }}
      >
        Toggle
      </button>
      <motion.div
        data-testid="motion-sample"
        className="size-16 rounded-lg bg-primary"
        initial={false}
        animate={{ opacity: shown ? 1 : 0.25 }}
        transition={transition.slow}
      />
    </div>
  );
}

const meta = {
  title: "Theme/Motion",
  component: MotionSample,
} satisfies Meta<typeof MotionSample>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Fade: Story = {};
