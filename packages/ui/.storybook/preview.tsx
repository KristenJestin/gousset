import type { Preview } from "@storybook/react-vite";

import { ThemeProvider } from "../src/components/theme-provider";

import "../src/styles/globals.css";

// Every story sits in the app's theme: the colour scheme on `<html>` and Motion's settings.
const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
};

export default preview;
