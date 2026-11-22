import { cn } from "../lib/utils";

export type LoaderProps = {
  /**
   * Said to screen readers ("Importing the statement"). Leave it out when something else already
   * says it is busy, like a button's `aria-busy`.
   */
  label?: string;
  /** `em` follows the text it sits in (the default); `sm` is 14 px, `md` 16 px, `lg` 24 px. */
  size?: "em" | "sm" | "md" | "lg";
};

/**
 * The one loading indicator for an action or a job: a coin falling into a pocket (docs/design.md,
 * "Loading"). It takes the text's colour. The drawing and its keyframes live here and in
 * `globals.css` only: CSS animation, no script, no inline style. Under reduced motion nothing
 * falls; the coin pulses softly.
 *
 * Blocks whose data is coming get a skeleton, not a loader.
 */
export function Loader({ label, size = "em" }: LoaderProps) {
  const small = size === "sm";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-slot="loader"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable={false}
      className={cn(
        "shrink-0 overflow-visible",
        size === "em" && "size-em",
        size === "sm" && "size-3.5",
        size === "md" && "size-4",
        size === "lg" && "size-6",
      )}
    >
      {/* The pocket; thickened at 14 px so it still reads in a small button. */}
      <path d="M5 11v4a7 7 0 0 0 14 0v-4" strokeWidth={small ? 3 : 2.6} />
      <circle
        cx="12"
        cy="5"
        r={small ? 3.4 : 3}
        fill="currentColor"
        stroke="none"
        data-reduced-motion="own"
        className="animate-coin-fall motion-reduce:animate-coin-pulse"
      />
    </svg>
  );
}
