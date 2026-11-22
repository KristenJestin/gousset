/** Failed sign-ins an e-mail may have from one address within the window before it is refused. */
export const MAX_FAILURES_PER_EMAIL = 5;

/** Failed sign-ins one client address may have within the window, whatever the e-mails tried. */
export const MAX_FAILURES_PER_ADDRESS = 20;

/** The window attempts are counted in, and how long a key stays refused. */
export const LOCK_MINUTES = 15;

const LOCK_MS = LOCK_MINUTES * 60_000;

type Attempts = { times: Array<number>; lockedUntil: number | undefined };

/**
 * Sign-in attempts counted per key in this process's memory. An attempt counts as soon as it is
 * admitted, so attempts sent at once cannot all pass before the first one fails; one that turns
 * out not to be a failure is released. A restart forgets the counts, which is acceptable for one
 * installation at home.
 */
export function createFailureLimit(maxFailures: number) {
  const byKey = new Map<string, Attempts>();

  function forgetExpired(now: number) {
    for (const [key, attempts] of byKey) {
      const locked = attempts.lockedUntil !== undefined && attempts.lockedUntil > now;
      const recent = attempts.times.some((time) => time > now - LOCK_MS);

      if (!locked && !recent) {
        byKey.delete(key);
      }
    }
  }

  return {
    /**
     * Admits an attempt and counts it, or refuses it: then gives when the key may try again. The
     * key is refused once it has as many attempts in the window as the limit allows.
     */
    admit(key: string, now: number): number | undefined {
      forgetExpired(now);

      const attempts = byKey.get(key) ?? { times: [], lockedUntil: undefined };

      if (attempts.lockedUntil !== undefined && attempts.lockedUntil > now) {
        return attempts.lockedUntil;
      }

      attempts.times = attempts.times.filter((time) => time > now - LOCK_MS);

      if (attempts.times.length >= maxFailures) {
        attempts.lockedUntil = now + LOCK_MS;
        attempts.times = [];
        byKey.set(key, attempts);

        return attempts.lockedUntil;
      }

      attempts.times.push(now);
      byKey.set(key, attempts);

      return undefined;
    },

    /** Gives back the last attempt admitted, which turned out not to be a failure. */
    release(key: string) {
      byKey.get(key)?.times.pop();
    },

    /** Forgets every attempt of the key. */
    clear(key: string) {
      byKey.delete(key);
    },
  };
}

/** Failures on one account, from any addresses, before its answers start slowing down. */
export const SLOW_DOWN_AFTER = 10;

/** The longest an answer is held back. */
export const MAX_DELAY_MS = 30_000;

const accountOf = (account: string) => account.trim().toLowerCase();

const emailKey = (account: string, address: string | undefined) =>
  `${accountOf(account)}|${address ?? "unknown"}`;

/**
 * Failures on each account from every address, in the window. They never refuse anyone: past
 * `SLOW_DOWN_AFTER`, each answer on the account waits longer (1 s, doubling, up to 30 s), so that
 * guessing from many addresses gets slow while the owner can still sign in.
 */
function createAccountSlowdown() {
  const byAccount = new Map<string, Array<number>>();

  const recent = (account: string, now: number) =>
    (byAccount.get(account) ?? []).filter((time) => time > now - LOCK_MS);

  return {
    delayFor(account: string, now: number): number {
      const over = recent(account, now).length - SLOW_DOWN_AFTER;

      return over < 0 ? 0 : Math.min(1000 * 2 ** over, MAX_DELAY_MS);
    },

    recordFailure(account: string, now: number) {
      for (const [key, times] of byAccount) {
        if (!times.some((time) => time > now - LOCK_MS)) {
          byAccount.delete(key);
        }
      }

      byAccount.set(account, [...recent(account, now), now]);
    },

    clear(account: string) {
      byAccount.delete(account);
    },
  };
}

/** How an admitted sign-in attempt ended. */
export type SignInOutcome = "succeeded" | "failed" | "not-counted";

/**
 * The limits on attempts at a password, by account (an e-mail when signing in, the user when
 * changing a password): per account from one client address, so that a stranger cannot lock the
 * owner out from the owner's own address; per client address, so that one address cannot try many
 * accounts; and a growing delay per account across addresses, so that guessing from many
 * addresses gets slow. `undefined` addresses (a call from inside the server) share one key.
 */
export function createSignInLimits() {
  const byEmail = createFailureLimit(MAX_FAILURES_PER_EMAIL);
  const byAddress = createFailureLimit(MAX_FAILURES_PER_ADDRESS);
  const slowdown = createAccountSlowdown();
  const checking = new Set<string>();

  return {
    /**
     * Claims the one password check an account under attack may have in flight; `false` when one
     * already is. Without it, requests sent at once would all wait the same delay, then all be
     * checked.
     */
    claimCheck(account: string): boolean {
      if (checking.has(accountOf(account))) {
        return false;
      }

      checking.add(accountOf(account));

      return true;
    },

    releaseCheck(account: string) {
      checking.delete(accountOf(account));
    },

    /** How long to hold the answer back, from the account's failures from every address. */
    delayFor(account: string, now: number): number {
      return slowdown.delayFor(accountOf(account), now);
    },

    /** Admits an attempt, or gives when it may be tried again. */
    admit(email: string, address: string | undefined, now: number): number | undefined {
      const key = emailKey(email, address);
      const emailUntil = byEmail.admit(key, now);

      if (emailUntil !== undefined) {
        return emailUntil;
      }

      const addressUntil = address === undefined ? undefined : byAddress.admit(address, now);

      if (addressUntil !== undefined) {
        byEmail.release(key);
      }

      return addressUntil;
    },

    /**
     * Settles an admitted attempt. A success clears the e-mail's count but gives back only its
     * own attempt to the address: one valid account must not buy fresh attempts on the others.
     */
    settle(email: string, address: string | undefined, outcome: SignInOutcome, now: number) {
      const key = emailKey(email, address);

      switch (outcome) {
        case "failed":
          slowdown.recordFailure(accountOf(email), now);

          return;
        case "succeeded":
          byEmail.clear(key);
          slowdown.clear(accountOf(email));
          break;
        case "not-counted":
          byEmail.release(key);
          break;
      }

      if (address !== undefined) {
        byAddress.release(address);
      }
    },
  };
}
