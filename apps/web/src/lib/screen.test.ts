import { describe, expect, test } from "vite-plus/test";

import { screenOf } from "./screen";

describe("screenOf", () => {
  test("counts the subjects' screen and each of its subjects as one screen", () => {
    expect(screenOf("/subjects")).toBe("/subjects");
    expect(screenOf("/subjects/")).toBe("/subjects");
    expect(screenOf("/subjects/0b7f2c4e-1d3a-4c5b-9e8f-6a7b8c9d0e1f")).toBe("/subjects");
  });

  test("keeps every other address as its own screen", () => {
    expect(screenOf("/")).toBe("/");
    expect(screenOf("/operations")).toBe("/operations");
    expect(screenOf("/accounts/0b7f2c4e-1d3a-4c5b-9e8f-6a7b8c9d0e1f")).toBe(
      "/accounts/0b7f2c4e-1d3a-4c5b-9e8f-6a7b8c9d0e1f",
    );
    expect(screenOf("/settings")).toBe("/settings");
    expect(screenOf("/settings/categories")).toBe("/settings/categories");
    expect(screenOf("/subjectsx")).toBe("/subjectsx");
  });
});
