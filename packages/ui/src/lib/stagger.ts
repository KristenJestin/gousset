/** A handful of steps so a short list staggers without naming an exact delay per row. */
const STAGGER_DELAYS = [
  "",
  "delay-75",
  "delay-100",
  "delay-150",
  "delay-200",
  "delay-300",
] as const;

/** The entrance delay class of the row at `index` in a staggered list. */
export function staggerDelay(index: number) {
  return STAGGER_DELAYS[index % STAGGER_DELAYS.length];
}
