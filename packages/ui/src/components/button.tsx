import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/utils";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: "primary" | "secondary";
  /**
   * While an action runs: disabled and announced as busy, keeping its width. The `Loader` in
   * place of the icon comes with the shared components (#7).
   */
  loading?: boolean;
};

/** A button. `primary` for the one action of a form or a screen, `secondary` for the others. */
export function Button({ variant = "primary", loading = false, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "secondary" &&
          "border-input bg-background text-foreground hover:bg-muted border",
      )}
    />
  );
}
