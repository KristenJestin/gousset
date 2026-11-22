import { describe, expect, it } from "vite-plus/test";

import {
  createFailureLimit,
  createSignInLimits,
  LOCK_MINUTES,
  MAX_DELAY_MS,
  MAX_FAILURES_PER_ADDRESS,
  MAX_FAILURES_PER_EMAIL,
  SLOW_DOWN_AFTER,
} from "./sign-in-attempts";

/** One failed attempt on the account from its own address, as a distributed guesser does. */
function failFrom(limits: ReturnType<typeof createSignInLimits>, index: number) {
  const address = `198.51.${Math.floor(index / 256)}.${index % 256}`;

  expect(limits.admit("ada@example.com", address, start)).toBeUndefined();
  limits.settle("ada@example.com", address, "failed", start);
}

describe("failures on one account from many addresses", () => {
  it("slow every answer down, more and more, once there are many", () => {
    const limits = createSignInLimits();
    const delays: Array<number> = [];

    for (let i = 0; i < SLOW_DOWN_AFTER + 6; i++) {
      delays.push(limits.delayFor("ada@example.com", start));
      failFrom(limits, i);
    }

    expect(delays.slice(0, SLOW_DOWN_AFTER)).toEqual(
      Array.from({ length: SLOW_DOWN_AFTER }, () => 0),
    );
    expect(delays.slice(SLOW_DOWN_AFTER)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000]);
    expect(limits.delayFor("ada@example.com", start)).toBe(MAX_DELAY_MS);
  });

  it("never lock the owner out: the owner's own address is still admitted", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < 1000; i++) {
      failFrom(limits, i);
    }

    expect(limits.admit("ada@example.com", "203.0.113.7", start)).toBeUndefined();
  });

  it("stop slowing down once the window has passed", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < SLOW_DOWN_AFTER + 3; i++) {
      failFrom(limits, i);
    }

    expect(limits.delayFor("ada@example.com", start + LOCK_MINUTES * 60_000)).toBe(0);
  });

  it("stop slowing down after the owner signs in", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < SLOW_DOWN_AFTER + 3; i++) {
      failFrom(limits, i);
    }

    expect(limits.admit("ada@example.com", "203.0.113.7", start)).toBeUndefined();
    limits.settle("ada@example.com", "203.0.113.7", "succeeded", start);

    expect(limits.delayFor("ada@example.com", start)).toBe(0);
  });
});

const minute = 60_000;
const start = Date.UTC(2026, 10, 22, 9, 0);
const max = 5;

/** Admits `count` attempts on a key, each failing. */
function failTimes(limit: ReturnType<typeof createFailureLimit>, key: string, count: number) {
  for (let i = 0; i < count; i++) {
    expect(limit.admit(key, start)).toBeUndefined();
  }
}

describe("a failure limit", () => {
  it("admits attempts until the limit, then refuses for a while", () => {
    const limit = createFailureLimit(max);

    failTimes(limit, "key", max);

    expect(limit.admit("key", start)).toBe(start + LOCK_MINUTES * minute);
    expect(limit.admit("key", start + LOCK_MINUTES * minute - 1)).toBe(
      start + LOCK_MINUTES * minute,
    );
    expect(limit.admit("key", start + LOCK_MINUTES * minute)).toBeUndefined();
  });

  it("counts an attempt as soon as it is admitted, so attempts at once cannot all pass", () => {
    const limit = createFailureLimit(max);
    const answers = Array.from({ length: max * 2 }, () => limit.admit("key", start));

    expect(answers.filter((until) => until === undefined)).toHaveLength(max);
  });

  it("gives an attempt back when it is released", () => {
    const limit = createFailureLimit(max);

    failTimes(limit, "key", max - 1);
    expect(limit.admit("key", start)).toBeUndefined();
    limit.release("key");

    expect(limit.admit("key", start)).toBeUndefined();
  });

  it("forgets attempts older than the window", () => {
    const limit = createFailureLimit(max);

    failTimes(limit, "key", max);

    expect(limit.admit("key", start + LOCK_MINUTES * minute)).toBeUndefined();
  });

  it("starts afresh when cleared", () => {
    const limit = createFailureLimit(max);

    failTimes(limit, "key", max);
    limit.clear("key");

    expect(limit.admit("key", start)).toBeUndefined();
  });

  it("counts each key apart", () => {
    const limit = createFailureLimit(max);

    failTimes(limit, "one", max);

    expect(limit.admit("one", start)).toBeDefined();
    expect(limit.admit("two", start)).toBeUndefined();
  });
});

/** One sign-in attempt, admitted, that fails. */
function fail(limits: ReturnType<typeof createSignInLimits>, email: string, address: string) {
  expect(limits.admit(email, address, start)).toBeUndefined();
  limits.settle(email, address, "failed", start);
}

describe("the sign-in limits", () => {
  const stranger = "203.0.113.66";
  const owner = "198.51.100.7";

  it("refuses an e-mail from an address after too many failures, even with the right password", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      fail(limits, "ada@example.com", stranger);
    }

    expect(limits.admit("ada@example.com", stranger, start)).toBeDefined();
  });

  it("never lets a stranger lock the owner out from the owner's own address", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      fail(limits, "ada@example.com", stranger);
    }

    expect(limits.admit("ada@example.com", owner, start)).toBeUndefined();
  });

  it("refuses an address that fails on too many e-mails", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < MAX_FAILURES_PER_ADDRESS; i++) {
      fail(limits, `person${i}@example.com`, stranger);
    }

    expect(limits.admit("someone.else@example.com", stranger, start)).toBeDefined();
    expect(limits.admit("someone.else@example.com", owner, start)).toBeUndefined();
  });

  it("matches an e-mail whatever its case", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      fail(limits, "Ada@Example.com", stranger);
    }

    expect(limits.admit("ada@example.com", stranger, start)).toBeDefined();
  });

  it("clears the e-mail's count on success, but never the address's", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < MAX_FAILURES_PER_ADDRESS - 1; i++) {
      fail(limits, `person${i}@example.com`, stranger);
    }

    expect(limits.admit("grace@example.com", stranger, start)).toBeUndefined();
    limits.settle("grace@example.com", stranger, "succeeded", start);

    // The success gave back its own attempt only: one more failure and the address is refused.
    fail(limits, "person-last@example.com", stranger);
    expect(limits.admit("anyone@example.com", stranger, start)).toBeDefined();
  });

  it("gives both counts back for an attempt that is not a failure", () => {
    const limits = createSignInLimits();

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL * 3; i++) {
      expect(limits.admit("ada@example.com", stranger, start)).toBeUndefined();
      limits.settle("ada@example.com", stranger, "not-counted", start);
    }
  });
});
