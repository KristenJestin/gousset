// Motion's shared values (docs/design.md, "Motion"): short durations, easing out at the end. The
// CSS transitions use the same through `--default-transition-*` in `globals.css`. Reduced motion
// is handled once, in `ThemeProvider` and `globals.css`: no component checks it on its own.

/** Durations, in seconds as Motion takes them. */
export const duration = {
  /** A hover, a press, a small state change. */
  fast: 0.15,
  /** The default: a value that moves, a line that folds. */
  base: 0.2,
  /** A panel that opens, a layout that changes. */
  slow: 0.3,
} as const;

/** Ease-out: fast at the start, settling at the end; the same curve as Tailwind's `ease-out`. */
export const easeOut = [0, 0, 0.2, 1] as const;

/** Ready-made transitions for `transition={...}`. */
export const transition = {
  fast: { duration: duration.fast, ease: easeOut },
  base: { duration: duration.base, ease: easeOut },
  slow: { duration: duration.slow, ease: easeOut },
} as const;
