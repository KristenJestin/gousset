import { describe, expect, it } from "vite-plus/test";

import { guardAttempt } from "./attempt-guard";
import { createSignInLimits, MAX_FAILURES_PER_EMAIL, SLOW_DOWN_AFTER } from "./sign-in-attempts";

const start = Date.UTC(2026, 10, 22, 9, 0);
const address = "203.0.113.7";
const failed = (response: Response) => Promise.resolve(response.status === 401);

function answer(status: number) {
  return () => Promise.resolve(new Response(null, { status }));
}

/** The waits the guard asked for, without waiting. */
function recordingSleep() {
  const waits: Array<number> = [];

  return { waits, sleep: (ms: number) => Promise.resolve(void waits.push(ms)) };
}

describe("the attempt guard", () => {
  it("refuses with 429 and Retry-After once the limit is reached, without running the endpoint", async () => {
    const limits = createSignInLimits();
    const { sleep } = recordingSleep();
    const attempt = { account: "ada@example.com", address, now: () => start, sleep };

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      expect((await guardAttempt(limits, attempt, answer(401), failed)).status).toBe(401);
    }

    let ran = false;

    const refused = await guardAttempt(
      limits,
      attempt,
      () => {
        ran = true;

        return Promise.resolve(new Response(null, { status: 200 }));
      },
      failed,
    );

    expect(ran).toBe(false);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("900");
    expect(await refused.text()).toContain("TOO_MANY_ATTEMPTS");
  });

  it("gives the attempt back when the endpoint throws", async () => {
    const limits = createSignInLimits();
    const { sleep } = recordingSleep();
    const attempt = { account: "ada@example.com", address, now: () => start, sleep };

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL * 2; i++) {
      await expect(
        guardAttempt(limits, attempt, () => Promise.reject(new Error("database down")), failed),
      ).rejects.toThrow("database down");
    }

    expect((await guardAttempt(limits, attempt, answer(200), failed)).status).toBe(200);
  });

  it("gives the attempt back when the endpoint answers something other than a failure", async () => {
    const limits = createSignInLimits();
    const { sleep } = recordingSleep();
    const attempt = { account: "ada@example.com", address, now: () => start, sleep };

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL * 2; i++) {
      expect((await guardAttempt(limits, attempt, answer(500), failed)).status).toBe(500);
    }

    expect((await guardAttempt(limits, attempt, answer(200), failed)).status).toBe(200);
  });

  it("checks one password at a time on an account past the threshold, whatever the addresses", async () => {
    const limits = createSignInLimits();
    const { sleep } = recordingSleep();

    const from = (address: string) => ({
      account: "ada@example.com",
      address,
      now: () => start,
      sleep,
    });

    for (let i = 0; i < SLOW_DOWN_AFTER; i++) {
      await guardAttempt(limits, from(`198.51.100.${i}`), answer(401), failed);
    }

    let checked = 0;

    const check = async () => {
      checked++;
      await Promise.resolve();

      return new Response(null, { status: 401 });
    };

    const answers = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        guardAttempt(limits, from(`203.0.113.${i}`), check, failed),
      ),
    );

    expect(checked).toBe(1);
    expect(answers.filter((response) => response.status === 429)).toHaveLength(19);

    // Once that check is done, the next one may go.
    expect((await guardAttempt(limits, from("203.0.113.99"), check, failed)).status).toBe(401);
    expect(checked).toBe(2);
  });

  it("frees the account's check when it throws", async () => {
    const limits = createSignInLimits();
    const { sleep } = recordingSleep();

    const from = (address: string) => ({
      account: "ada@example.com",
      address,
      now: () => start,
      sleep,
    });

    for (let i = 0; i < SLOW_DOWN_AFTER; i++) {
      await guardAttempt(limits, from(`198.51.100.${i}`), answer(401), failed);
    }

    await expect(
      guardAttempt(limits, from("203.0.113.1"), () => Promise.reject(new Error("down")), failed),
    ).rejects.toThrow("down");

    expect((await guardAttempt(limits, from("203.0.113.2"), answer(401), failed)).status).toBe(401);
  });

  it("makes distributed guessing on one account slower and slower", async () => {
    const limits = createSignInLimits();
    const { waits, sleep } = recordingSleep();

    for (let i = 0; i < SLOW_DOWN_AFTER + 3; i++) {
      const from = {
        account: "ada@example.com",
        address: `198.51.100.${i}`,
        now: () => start,
        sleep,
      };

      expect((await guardAttempt(limits, from, answer(401), failed)).status).toBe(401);
    }

    expect(waits).toEqual([1000, 2000, 4000]);
  });
});
