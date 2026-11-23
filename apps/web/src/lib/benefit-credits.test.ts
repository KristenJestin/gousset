import type { AccountCredits } from "@gousset/core";
import { describe, expect, test } from "vite-plus/test";

import { benefitCreditsOf, creditExpiryTag, creditOrderLabel } from "./benefit-credits";

const eur = (minor: number) => ({ minor, currency: "EUR" });

const CREDITS: AccountCredits = {
  order: "oldest_first",
  open: [
    {
      lineId: null,
      creditedOn: null,
      label: null,
      amount: eur(2000),
      left: eur(500),
      expiresOn: null,
    },
    {
      lineId: "0b6f1c1e-6f0e-4d4e-9f6a-1a2b3c4d5e6f",
      creditedOn: "2026-10-01",
      label: "MEALCARD CREDIT",
      amount: eur(8000),
      left: eur(8000),
      expiresOn: "2026-11-30",
    },
  ],
  expiring: [
    { day: "2026-10-15", amount: eur(1200) },
    { day: "2026-11-30", amount: eur(8000) },
  ],
  uncovered: eur(0),
};

describe("benefit-credits", () => {
  test("words each order of use", () => {
    expect(creditOrderLabel("oldest_first")).toBe("Oldest first");
    expect(creditOrderLabel("expiring_first")).toBe("Soonest expiry first, as the issuer does");
  });

  test("gives the opening balance its own id and words, and each credit its days", () => {
    const shown = benefitCreditsOf(CREDITS, "2026-10-31", "en");

    expect(shown.order).toBe("Oldest first");
    expect(shown.credits).toEqual([
      {
        id: "opening",
        day: null,
        label: "Opening balance",
        amount: eur(2000),
        left: eur(500),
        expires: null,
      },
      {
        id: "0b6f1c1e-6f0e-4d4e-9f6a-1a2b3c4d5e6f",
        day: "Oct 1",
        label: "MEALCARD CREDIT",
        amount: eur(8000),
        left: eur(8000),
        expires: "Nov 30",
      },
    ]);
  });

  test("marks a day before today as expired, and today's or a later one as not", () => {
    const shown = benefitCreditsOf(CREDITS, "2026-10-31", "en");

    expect(shown.expiring).toEqual([
      { day: "Oct 15", amount: eur(1200), expired: true },
      { day: "Nov 30", amount: eur(8000), expired: false },
    ]);

    expect(benefitCreditsOf(CREDITS, "2026-10-15", "en").expiring[0]?.expired).toBe(false);
  });

  test("gives what is uncovered only when there is some", () => {
    expect(benefitCreditsOf(CREDITS, "2026-10-31", "en").uncovered).toBeUndefined();

    expect(
      benefitCreditsOf({ ...CREDITS, uncovered: eur(300) }, "2026-10-31", "en").uncovered,
    ).toEqual(eur(300));
  });

  test("tags a credit line with its expiry, and no other line", () => {
    expect(creditExpiryTag("2026-12-31", "en")).toBe("expires Dec 31");
    expect(creditExpiryTag(null, "en")).toBeUndefined();
  });
});
