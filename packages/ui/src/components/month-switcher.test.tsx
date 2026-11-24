import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MonthSwitcher } from "./month-switcher";

// The server's clock and timezone may name another month than the browser's, and hydration keeps
// the server's attributes: without `latest`, the server never lets Next lead anywhere.
const nextTag = (markup: string) => markup.match(/<button[^>]*aria-label="Next month"[^>]*>/)?.[0];

/** Previous, on a switcher bound to November and December 2026, showing `month` of 2026. */
const previousAt = (month: number) =>
  renderToString(
    <MonthSwitcher
      value={{ year: 2026, month }}
      earliest={{ year: 2026, month: 11 }}
      latest={{ year: 2026, month: 12 }}
      onChange={() => undefined}
    />,
  ).match(/<button[^>]*aria-label="Previous month"[^>]*>/)?.[0];

/** The name a switcher's group is given. */
const named = (markup: string) => markup.match(/role="group"[^>]*aria-label="([^"]*)"/)?.[1];

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

  it("is named Month, or the label it is given when a page has two", () => {
    expect(
      named(
        renderToString(
          <MonthSwitcher value={{ year: 2026, month: 10 }} onChange={() => undefined} />,
        ),
      ),
    ).toBe("Month");

    expect(
      named(
        renderToString(
          <MonthSwitcher
            value={{ year: 2026, month: 10 }}
            label="Recurring payments month"
            onChange={() => undefined}
          />,
        ),
      ),
    ).toBe("Recurring payments month");
  });

  it("disables Previous on the earliest month it is given, and only there", () => {
    expect(previousAt(11)).toMatch(/aria-disabled="true"|\sdisabled=""/);
    expect(previousAt(12)).toBeDefined();
    expect(previousAt(12)).not.toMatch(/aria-disabled="true"|\sdisabled=""/);
  });
});
