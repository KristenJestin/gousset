import type { LineToReview, LinesToReview } from "@gousset/core";
import { describe, expect, test } from "vite-plus/test";

import { withLineBack, withoutLine } from "./review-lines";

const line = (id: string): LineToReview => ({
  id,
  bookedOn: "2026-10-01",
  label: `LINE ${id}`,
  merchant: null,
  category: null,
  account: "Current account",
  amount: { minor: -100, currency: "EUR" },
});

const list = (...ids: Array<string>): LinesToReview => ({
  month: "2026-10",
  count: ids.length,
  lines: ids.map(line),
});

const ids = (lines: LinesToReview) => lines.lines.map((kept) => kept.id);

describe("withoutLine", () => {
  test("takes the line out and says where it was", () => {
    const { list: rest, line: taken, index } = withoutLine(list("l1", "l2", "l3"), "l2");

    expect(ids(rest)).toEqual(["l1", "l3"]);
    expect(rest.count).toBe(2);
    expect(taken?.id).toBe("l2");
    expect(index).toBe(1);
  });
});

describe("withLineBack", () => {
  test("puts a refused line back where it was", () => {
    expect(ids(withLineBack(list("l1", "l3"), line("l2"), 1))).toEqual(["l1", "l2", "l3"]);
  });

  // Approve l1, then l2; l1 is refused while l2 is still on its way: l2 stays folded away.
  test("keeps the other approvals made meanwhile", () => {
    const afterBoth = withoutLine(withoutLine(list("l1", "l2", "l3"), "l1").list, "l2").list;
    const back = withLineBack(afterBoth, line("l1"), 0);

    expect(ids(back)).toEqual(["l1", "l3"]);
    expect(back.count).toBe(2);
  });

  test("does not add a line twice, and keeps the index within the list", () => {
    expect(ids(withLineBack(list("l1"), line("l1"), 0))).toEqual(["l1"]);
    expect(ids(withLineBack(list("l1"), line("l9"), 5))).toEqual(["l1", "l9"]);
  });
});
