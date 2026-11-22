import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MonthSwitcher } from "./month-switcher";

// The server's clock and timezone may name another month than the browser's, and hydration keeps
// the server's attributes: without `latest`, the server never lets Next lead anywhere.
const nextTag = (markup: string) => markup.match(/<button[^>]*aria-label="Next month"[^>]*>/)?.[0];

describe("MonthSwitcher on the server", () => {
  it("disables Next without a latest month, however far back the month is", () => {
    const tag = nextTag(
      renderToString(<MonthSwitcher value={{ year: 2000, month: 1 }} onChange={() => undefined} />),
    );

    expect(tag).toMatch(/aria-disabled="true"|\sdisabled=""/);
  });

  it("follows the latest month it is given", () => {
    const tag = nextTag(
      renderToString(
        <MonthSwitcher
          value={{ year: 2026, month: 10 }}
          latest={{ year: 2026, month: 11 }}
          onChange={() => undefined}
        />,
      ),
    );

    expect(tag).toBeDefined();
    expect(tag).not.toMatch(/aria-disabled="true"|\sdisabled=""/);
  });
});
