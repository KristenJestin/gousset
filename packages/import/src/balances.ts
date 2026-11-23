import type { Balance } from "./statement";

// A file of several statements of one account (a day each, or pages of one) gives a balance pair
// for each: the file's opening balance is the earliest, its closing balance the latest, whatever
// order the statements come in.

/** The earliest of the balances, the first of those on its day; `null` when there is none. */
export function earliest(balances: ReadonlyArray<Balance>): Balance | null {
  return balances.reduce<Balance | null>(
    (found, balance) => (found === null || balance.on < found.on ? balance : found),
    null,
  );
}

/** The latest of the balances, the last of those on its day; `null` when there is none. */
export function latest(balances: ReadonlyArray<Balance>): Balance | null {
  return balances.reduce<Balance | null>(
    (found, balance) => (found === null || balance.on >= found.on ? balance : found),
    null,
  );
}
