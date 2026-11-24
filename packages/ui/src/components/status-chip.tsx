import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { Loader } from "./loader";

/**
 * What a state asks of the user. `action`: something waits for them (an account to choose);
 * `error`: it failed; `busy`: it runs; `done`: it went well, quietly; `undone`: taken back;
 * `neutral`: anything else.
 */
export type StatusTone = "neutral" | "busy" | "action" | "error" | "done" | "undone";

const ICON_OF = {
  neutral: null,
  busy: null,
  action: "error",
  error: "warning",
  done: "success",
  undone: "undo",
} satisfies { readonly [Tone in StatusTone]: IconName | null };

/**
 * Where something stands, as a pill (an import's "Imported", "Account to choose", "Failed").
 * Colour only where the user has something to do (violet) or something failed (red); a finished
 * state stays a quiet grey pill with a green mark, an undone one is outlined, a running one carries
 * the loader. The words are the page's. It never wraps.
 *
 * Motion: none of its own; the loader of a running state falls, and pulses under reduced motion.
 */
export function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: string;
}) {
  const icon = ICON_OF[tone];

  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        (tone === "neutral" || tone === "busy" || tone === "done") &&
          "bg-muted text-soft-foreground",
        tone === "action" && "bg-primary/12 text-primary",
        tone === "error" && "bg-destructive/12 text-destructive",
        tone === "undone" && "border text-muted-foreground",
      )}
    >
      {tone === "busy" ? (
        <span className="flex text-muted-foreground">
          <Loader size="sm" />
        </span>
      ) : null}
      {icon === null ? null : (
        <span className={cn("flex", tone === "done" && "text-success")}>
          <Icon name={icon} size="sm" />
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
