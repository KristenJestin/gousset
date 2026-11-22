import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Breakdown } from "./breakdown";
import { MonthBar } from "./month-bar";
import { ReviewLines } from "./review-lines";

// The server's markup carries no `style` attribute: the Content Security Policy forbids them
// (apps/web/src/security.ts), and the browser would report each one.

const eur = (minor: number) => ({ minor, currency: "EUR" });

describe("the review's components on the server", () => {
  it("write no style attribute", () => {
    const markup = renderToString(
      <>
        <MonthBar
          received={eur(312_000)}
          spent={eur(203_000)}
          saved={eur(60_000)}
          left={eur(49_000)}
          restricted={eur(12_000)}
        />
        <Breakdown
          rows={[{ id: "housing", name: "Housing", amount: eur(69_000), benchmark: eur(69_000) }]}
          onSelect={() => {}}
        />
        <ReviewLines
          lines={[
            {
              id: "l1",
              label: "PAYLINK *PIXELPLAY",
              title: "Pixelplay",
              tags: [],
              amount: eur(-1499),
            },
          ]}
          approveText="Approve"
          approveLabel={(line) => `Approve ${line.label}`}
          onApprove={() => {}}
          label="To review"
        />
      </>,
    );

    expect(markup).not.toMatch(/style=/);
  });
});
