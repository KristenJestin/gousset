import { describe, expect, test } from "vite-plus/test";

import { jobPercent, stepStates } from "./job-progress";
import type { JobPosition } from "./job-progress";

const STEPS = ["read", "match", "save", "finish"];

const at = (position: Partial<JobPosition>): JobPosition => ({
  phase: "running",
  steps: STEPS,
  step: null,
  done: null,
  total: null,
  ...position,
});

describe("jobPercent", () => {
  test("is 0 before the first step", () => {
    expect(jobPercent(at({ phase: "waiting" }))).toBe(0);
    expect(jobPercent(at({}))).toBe(0);
  });

  test("weighs each step the same", () => {
    expect(jobPercent(at({ step: "match" }))).toBe(25);
    expect(jobPercent(at({ step: "finish" }))).toBe(75);
  });

  test("counts the part of the step under way that is done", () => {
    expect(jobPercent(at({ step: "match", done: 50, total: 100 }))).toBe(37.5);
  });

  test("never goes past the step's end, nor divides by nothing", () => {
    expect(jobPercent(at({ step: "read", done: 12, total: 10 }))).toBe(25);
    expect(jobPercent(at({ step: "read", done: 3, total: 0 }))).toBe(0);
    expect(jobPercent(at({ step: "read", done: 3, total: null }))).toBe(0);
  });

  test("is 100 once completed, and stays where it stopped once failed", () => {
    expect(jobPercent(at({ phase: "completed", step: "save" }))).toBe(100);
    expect(jobPercent(at({ phase: "failed", step: "save" }))).toBe(50);
  });

  test("reads an unknown step as not started", () => {
    expect(jobPercent(at({ step: "elsewhere" }))).toBe(0);
  });
});

describe("stepStates", () => {
  test("the steps before the current one are done, those after are to come", () => {
    expect(stepStates(at({ step: "match" }))).toEqual(["done", "current", "pending", "pending"]);
  });

  test("every step is to come before the first", () => {
    expect(stepStates(at({ phase: "waiting" }))).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  test("a job retrying or failed marks the step it stopped at", () => {
    expect(stepStates(at({ phase: "retrying", step: "save" }))).toEqual([
      "done",
      "done",
      "stopped",
      "pending",
    ]);
    expect(stepStates(at({ phase: "failed", step: "read" }))[0]).toBe("stopped");
  });

  test("every step is done once completed", () => {
    expect(stepStates(at({ phase: "completed", step: "save" }))).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });
});
