/**
 * A small seeded generator (mulberry32): the same seed gives the same numbers on every machine,
 * so the made-up data is the same for every story, test and demonstration.
 */
export function seededRandom(seed: number) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;

    let value = state;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  /** A whole number from `min` to `max`, both included. */
  const between = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  /** One of the choices. */
  const pick = <Choice>(choices: ReadonlyArray<Choice>): Choice => {
    const choice = choices[between(0, choices.length - 1)];

    if (choice === undefined) {
      throw new Error("Nothing to pick from.");
    }

    return choice;
  };

  return { next, between, pick };
}

/** A seed of its own for one month, from the fixture's seed and the month's name. */
export function monthSeed(seed: number, month: string): number {
  let hash = seed >>> 0;

  for (const character of month) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }

  return hash;
}
