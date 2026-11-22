import type { StorybookConfig } from "@storybook/react-vite";

// Every component of `packages/ui` gets its stories next to it (`*.stories.tsx`). Tailwind runs
// through the package's `postcss.config.mjs`, which Vite picks up on its own.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
};

export default config;
