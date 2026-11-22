import type { createSignInLimits } from "./sign-in-attempts";

/** Gousset's refusal when too many attempts failed, which the interface translates. */
export const TOO_MANY_ATTEMPTS = "TOO_MANY_ATTEMPTS";

type Attempt = {
  /** Whose password is tried: an e-mail when signing in, `user:<id>` when changing a password. */
  account: string;
  address: string | undefined;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

type Limits = ReturnType<typeof createSignInLimits>;

function refusal(retryAfterMs: number) {
  return Response.json(
    { code: TOO_MANY_ATTEMPTS, message: "Too many failed attempts: try again later." },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

/** Runs the endpoint, then settles the attempt from its answer; a throw gives it back. */
async function runAndSettle(
  limits: Limits,
  attempt: Attempt,
  run: () => Promise<Response>,
  isFailure: (response: Response) => Promise<boolean>,
): Promise<Response> {
  const { account, address } = attempt;
  let response: Response;

  try {
    response = await run();
  } catch (error) {
    limits.settle(account, address, "not-counted", attempt.now());

    throw error;
  }

  const outcome = response.ok
    ? "succeeded"
    : (await isFailure(response))
      ? "failed"
      : "not-counted";

  limits.settle(account, address, outcome, attempt.now());

  return response;
}

/**
 * Runs one attempt at a password under the limits. It is admitted or refused before the endpoint
 * runs, then settled from what the endpoint answered: a success, a failure (as `isFailure` reads
 * it), or anything else, a throw included, which gives the attempt back.
 *
 * While the account is under attack from many addresses, each check waits a growing delay, and
 * only one check is in flight for it at a time: a request arriving meanwhile is refused at once,
 * its password never checked. Guessing is then held to about one try per delay, whatever the
 * number of addresses, while the owner is only slowed down, never locked out.
 */
export async function guardAttempt(
  limits: Limits,
  attempt: Attempt,
  run: () => Promise<Response>,
  isFailure: (response: Response) => Promise<boolean>,
): Promise<Response> {
  const { account, address } = attempt;
  const until = limits.admit(account, address, attempt.now());

  if (until !== undefined) {
    return refusal(until - attempt.now());
  }

  const delay = limits.delayFor(account, attempt.now());

  if (delay === 0) {
    return runAndSettle(limits, attempt, run, isFailure);
  }

  if (!limits.claimCheck(account)) {
    limits.settle(account, address, "not-counted", attempt.now());

    return refusal(delay);
  }

  try {
    await attempt.sleep(delay);

    return await runAndSettle(limits, attempt, run, isFailure);
  } finally {
    limits.releaseCheck(account);
  }
}
