import { cn } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet" | "destructive";

export type ButtonSize = "md" | "sm";

/**
 * The classes every button-like control shares (`Button`, `IconButton`…): one look, set here.
 *
 * Motion: colours change in 150 ms on hover, it presses in slightly (scale 0.97) and back; cut
 * under reduced motion.
 */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize) {
  return cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none",
    "transition duration-150 ease-out active:scale-97",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:active:scale-100",
    "aria-busy:cursor-progress aria-busy:opacity-100",
    size === "md" && "h-9 px-4 text-sm",
    size === "sm" && "h-8 px-3 text-xs",
    variant === "primary" &&
      "bg-primary text-primary-foreground hover:bg-primary/90 data-disabled:hover:bg-primary",
    variant === "secondary" &&
      "border border-input bg-card text-foreground hover:bg-muted data-disabled:hover:bg-card",
    variant === "ghost" &&
      "bg-transparent text-foreground hover:bg-muted data-disabled:hover:bg-transparent",
    // A way back beside the way forward (undo an import): no surface, its text set back; it
    // turns red only on hover, never the same weight as the primary.
    variant === "quiet" &&
      "bg-transparent text-soft-foreground hover:bg-destructive/10 hover:text-destructive data-disabled:hover:bg-transparent data-disabled:hover:text-soft-foreground",
    variant === "destructive" &&
      "bg-destructive text-primary-foreground hover:bg-destructive/90 data-disabled:hover:bg-destructive",
  );
}
