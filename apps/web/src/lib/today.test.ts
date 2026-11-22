import { ConfigProvider, Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { E2E_CLOCK_VARIABLE, today } from "./today";

/** Noon, server time, on 9 March 2031: a day no run of this test is on. */
const REAL_NOW = new Date(2031, 2, 9, 12).getTime();

function run(requestedDay: string | undefined, env: Readonly<Record<string, string>>) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(REAL_NOW);

    return yield* today(requestedDay);
  }).pipe(
    Effect.provide(TestClock.layer()),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    Effect.runPromise,
  );
}

describe("today", () => {
  test("is the server's own day without the harness's variable", async () => {
    await expect(run(undefined, {})).resolves.toBe("2031-03-09");
  });

  test("ignores a requested day without the harness's variable", async () => {
    await expect(run("2027-05-15", {})).resolves.toBe("2031-03-09");
  });

  test("is the requested day under the harness's variable", async () => {
    await expect(run("2027-05-15", { [E2E_CLOCK_VARIABLE]: "on" })).resolves.toBe("2027-05-15");
  });

  test("is the server's own day under the harness's variable when no day is requested", async () => {
    await expect(run(undefined, { [E2E_CLOCK_VARIABLE]: "on" })).resolves.toBe("2031-03-09");
  });

  test("refuses a requested day that is not a day", async () => {
    await expect(run("2027-13-40", { [E2E_CLOCK_VARIABLE]: "on" })).rejects.toThrow();
  });

  test("refuses the variable set to anything but on", async () => {
    await expect(run("2027-05-15", { [E2E_CLOCK_VARIABLE]: "true" })).rejects.toThrow();
  });
});
