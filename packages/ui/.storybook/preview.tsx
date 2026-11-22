import type { Preview } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import type { ColorSchemeValue } from "@ui-sdk/core";

import { ThemeProvider } from "../src/components/theme-provider";
import { colorScheme } from "../src/lib/color-scheme";

import "../src/styles/globals.css";

const SCHEMES = ["system", "light", "dark"] as const satisfies ReadonlyArray<ColorSchemeValue>;

function isScheme(value: string): value is ColorSchemeValue {
  return SCHEMES.some((scheme) => scheme === value);
}

/**
 * The toolbar's scheme switch (also `&globals=scheme:dark` in a story's URL). It only acts once
 * it is moved away from "system", so a story's own choice, like the picker's, is left alone.
 */
function SchemeFromToolbar({ scheme, children }: { scheme: string; children: ReactNode }) {
  const moved = useRef(false);

  useEffect(() => {
    if (!isScheme(scheme) || (!moved.current && scheme === "system")) {
      return;
    }

    moved.current = true;
    colorScheme.set(scheme);
  }, [scheme]);

  return children;
}

// Every story sits in the app's theme: the colour scheme on `<html>` and Motion's settings. The
// toolbar switches the scheme and the viewport (desktop, phone) of any story.
const preview: Preview = {
  globalTypes: {
    scheme: {
      description: "Colour scheme",
      toolbar: {
        title: "Scheme",
        icon: "mirror",
        items: [
          { value: "system", title: "System" },
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: "system" },
  parameters: {
    layout: "padded",
    options: { storySort: { order: ["Theme", "Foundations", "Actions", "Inputs", "Money"] } },
  },
  decorators: [
    (Story, context) => (
      <ThemeProvider>
        <SchemeFromToolbar scheme={String(context.globals.scheme ?? "system")}>
          <Story />
        </SchemeFromToolbar>
      </ThemeProvider>
    ),
  ],
};

export default preview;
