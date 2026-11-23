import { describe, expect, test } from "vite-plus/test";

import { FAILURES, attemptEnded, attemptStarted, isOver, stepReported, viewOfRecord } from "./view";
import type { JobRecord } from "./view";

/** A job allowed two retries: three attempts in all. */
const RECORD: JobRecord = {
  id: "job-1",
  name: "test",
  state: "created",
  retryCount: 0,
  retryLimit: 2,
  output: null,
};

describe("viewOfRecord", () => {
  test("a job not started yet waits for its first attempt", () => {
    expect(viewOfRecord(RECORD)).toEqual({
      id: "job-1",
      job: "test",
      phase: "waiting",
      step: null,
      done: null,
      total: null,
      attempt: 1,
      attempts: 3,
      failure: null,
      touched: null,
    });
  });

  test("an active job runs the attempt after its retries so far", () => {
    expect(viewOfRecord({ ...RECORD, state: "active", retryCount: 1 })).toMatchObject({
      phase: "running",
      attempt: 2,
    });
  });

  test("a job in retry waits for the attempt after the one that failed, and says why", () => {
    const view = viewOfRecord({
      ...RECORD,
      state: "retry",
      retryCount: 0,
      output: { failure: "TEST_FAILURE" },
    });

    expect(view).toMatchObject({ phase: "retrying", attempt: 2, failure: "TEST_FAILURE" });
  });

  test("a job pg-boss failed itself (a stop, a timeout) reads as interrupted", () => {
    expect(viewOfRecord({ ...RECORD, state: "retry" })).toMatchObject({
      phase: "retrying",
      failure: FAILURES.interrupted,
    });
    expect(viewOfRecord({ ...RECORD, state: "failed", retryCount: 2 })).toMatchObject({
      phase: "failed",
      attempt: 3,
      failure: FAILURES.interrupted,
    });
  });

  test("a completed job says what it touched", () => {
    const view = viewOfRecord({
      ...RECORD,
      state: "completed",
      output: { touched: { months: ["2026-10"] } },
    });

    expect(view).toMatchObject({ phase: "completed", touched: { months: ["2026-10"] } });
    expect(isOver(view)).toBe(true);
  });

  test("a cancelled job is failed", () => {
    expect(viewOfRecord({ ...RECORD, state: "cancelled" }).phase).toBe("failed");
  });
});

describe("an attempt", () => {
  const claimed = { id: "job-1", name: "test", retryCount: 0, retryLimit: 2 };

  test("starts running, with no step yet", () => {
    expect(attemptStarted(claimed)).toMatchObject({ phase: "running", attempt: 1, step: null });
  });

  test("reports its steps and their counts", () => {
    const view = stepReported(attemptStarted(claimed), "reading", { done: 3, total: 10 });

    expect(view).toMatchObject({ step: "reading", done: 3, total: 10 });
    expect(stepReported(view, "saving")).toMatchObject({ step: "saving", done: null, total: null });
  });

  test("that succeeds completes the job with what it touched", () => {
    const view = attemptEnded(attemptStarted(claimed), { touched: { everyMonth: true } });

    expect(view).toMatchObject({ phase: "completed", touched: { everyMonth: true } });
  });

  test("that fails while attempts remain is retried, keeping the step it stopped at", () => {
    const running = stepReported(attemptStarted(claimed), "reading", { done: 3, total: 10 });
    const view = attemptEnded(running, { failure: "TEST_FAILURE", retry: true });

    expect(view).toMatchObject({
      phase: "retrying",
      attempt: 2,
      failure: "TEST_FAILURE",
      step: "reading",
    });
    expect(isOver(view)).toBe(false);
  });

  test("that fails on the last attempt fails the job", () => {
    const last = attemptStarted({ ...claimed, retryCount: 2 });

    expect(attemptEnded(last, { failure: "TEST_FAILURE", retry: true })).toMatchObject({
      phase: "failed",
      attempt: 3,
    });
  });

  test("that fails for good fails the job at once, whatever attempts remain", () => {
    const view = attemptEnded(attemptStarted(claimed), { failure: "UNREADABLE", retry: false });

    expect(view).toMatchObject({ phase: "failed", attempt: 1, failure: "UNREADABLE" });
  });
});
