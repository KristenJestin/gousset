import { composeStory, setProjectAnnotations } from "@storybook/react-vite";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import preview from "../../.storybook/preview";

// The server's markup carries no `style` attribute: the Content Security Policy forbids them
// (apps/web/src/security.ts), the browser drops each one, and hydration never puts it back. Every
// story of every component is rendered as the server renders a page, in the stories' own theme:
// a component, a state or a story added later is covered without touching this file.

setProjectAnnotations(preview);

// The components' stories, each file's meta and its stories; the theme's own pages (`src/styles`)
// read the stylesheet as text.
const metas = import.meta.glob<Meta>("./*.stories.tsx", { eager: true, import: "default" });
const modules = import.meta.glob<Record<string, StoryObj>>("./*.stories.tsx", { eager: true });

// The one exception, which no prop of ui-sdk's removes: the native input (a textarea for a
// select) it keeps beside a switch, a checkbox, a radio or a select, so that the control takes part in its form. ui-sdk
// writes its hiding as a `style` attribute; `globals.css` hides the same input from the
// stylesheet, so it stays hidden once the policy drops the attribute.
const UI_SDK_HIDDEN_INPUT =
  /^<(input|textarea) data-slot="[a-z-]+-input"[^>]* aria-hidden="true" tabindex="-1" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap;opacity:0;pointer-events:none"[^>]*>$/;

const styledTags = (markup: string) =>
  (markup.match(/<[^>]*\sstyle="[^"]*"[^>]*>/g) ?? []).filter(
    (tag) => !UI_SDK_HIDDEN_INPUT.test(tag),
  );

describe("every story on the server", () => {
  for (const [path, module] of Object.entries(modules)) {
    for (const [name, story] of Object.entries(module)) {
      const meta = metas[path];

      if (name === "default" || meta === undefined) {
        continue;
      }

      const Story = composeStory(story, meta, undefined, name);

      it(`${path} ${name} writes no style attribute`, () => {
        // The tags themselves, so that a failure says which.
        expect(styledTags(renderToString(<Story />))).toEqual([]);
      });
    }
  }
});

describe("the exception for ui-sdk's hidden inputs", () => {
  it("is ui-sdk's hidden input alone", () => {
    expect(
      styledTags(
        '<input data-slot="switch-input" type="checkbox" aria-hidden="true" tabindex="-1" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;opacity:0;pointer-events:none" name="a"/>',
      ),
    ).toEqual([]);
    expect(styledTags('<input data-slot="switch-input" style="color:red"/>')).toHaveLength(1);
    expect(styledTags('<div style="position:absolute;inset:0">')).toHaveLength(1);
  });
});
