import { useUiMessages } from "../hooks/use-ui-messages";
import { Button } from "./button";
import { StateLayout } from "./empty-state";
import type { StateSize } from "./empty-state";

export type ErrorStateProps = {
  /** Runs again what failed. A promise keeps the button busy, with the loader, until it settles. */
  onRetry: () => Promise<void> | void;
  /** What could not be loaded ("The breakdown could not be loaded"); a general title otherwise. */
  title?: string;
  /** What happened, in words the user can act on; a general line otherwise. Never a trace. */
  message?: string;
  /** `block` fills the block that failed, centred; `compact` is one row. */
  size?: StateSize;
};

/**
 * A block that failed to load (docs/architecture.md, "Data loading and skeletons"): the error
 * stays in its block, with a button to retry, and the rest of the page keeps working. Its title
 * and message are announced (`role="alert"`).
 */
export function ErrorState({ onRetry, title, message, size = "block" }: ErrorStateProps) {
  const messages = useUiMessages();

  return (
    <StateLayout
      size={size}
      icon="error"
      tone="error"
      text={
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {title ?? messages.states.errorTitle}
          </p>
          <p className="text-sm text-muted-foreground">{message ?? messages.states.errorMessage}</p>
        </div>
      }
      action={
        <Button
          variant="secondary"
          size={size === "compact" ? "sm" : "md"}
          icon="retry"
          onClick={() => onRetry()}
        >
          {messages.states.retry}
        </Button>
      }
    />
  );
}
