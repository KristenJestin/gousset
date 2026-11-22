import type { Meta, StoryObj } from "@storybook/react-vite";
import { motion } from "motion/react";
import { useState } from "react";

import { transition } from "@gousset/ui/lib/motion";

/**
 * The shared motion: a block that fades in over `transition.slow` (300 ms, ease-out) each time it
 * is replayed. When the system asks for reduced motion, even while the page is open, it appears
 * at once.
 */
function MotionSample() {
  const [round, setRound] = useState(0);

  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <button
        type="button"
        className="rounded-md border bg-card px-3 py-1 text-sm"
        onClick={() => {
          setRound(round + 1);
        }}
      >
        Replay
      </button>
      <motion.div
        key={round}
        data-testid="motion-sample"
        className="size-16 rounded-lg bg-primary"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
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

export const FadeIn: Story = {};
