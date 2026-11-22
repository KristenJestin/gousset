import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";
import type { IconName } from "./icon";

export type StateSize = "block" | "compact";

export type StateAction = {
  label: string;
  icon?: IconName;
  /** May return a promise: the button shows the loader while it runs. */
  onClick: () => Promise<void> | void;
};

export type EmptyStateProps = {
  /** What is missing, in the page's words ("No lines this month"). */
  title: string;
  /** One line of help: why it is empty, or what to do. */
  description?: string;
  /** `empty` (an inbox) unless a more telling icon fits. */
  icon?: IconName;
  /** The one thing to do about it ("Import statements"). */
  action?: StateAction;
  /** `block` fills a block, centred; `compact` is one row, inside a list or a small block. */
  size?: StateSize;
};

/**
 * What a block shows when it has nothing to show: an icon, a title, a line of help and maybe one
 * action. It sits inside a block and draws no block of its own. No illustration.
 */
export function EmptyState({
  title,
  description,
  icon = "empty",
  action,
  size = "block",
}: EmptyStateProps) {
  return (
    <StateLayout
      size={size}
      icon={icon}
      tone="neutral"
      text={
        <>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description === undefined ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </>
      }
      action={
        action === undefined ? null : (
          <Button
            variant="secondary"
            size={size === "compact" ? "sm" : "md"}
            icon={action.icon}
            onClick={() => action.onClick()}
          >
            {action.label}
          </Button>
        )
      }
    />
  );
}

/** The layout `EmptyState` and `ErrorState` share, so both take the same room in a block. */
export function StateLayout({
  size,
  icon,
  tone,
  text,
  action,
}: {
  size: StateSize;
  icon: IconName;
  tone: "neutral" | "error";
  text: ReactNode;
  action: ReactNode;
}) {
  const compact = size === "compact";

  return (
    <div
      data-slot="state"
      data-size={size}
      className={cn(
        "flex w-full",
        compact && "flex-row items-center gap-3 py-3",
        !compact && "flex-col items-center gap-3 px-4 py-10 text-center",
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          compact ? "size-8" : "size-10",
          tone === "neutral" && "bg-muted text-muted-foreground",
          tone === "error" && "bg-muted text-destructive",
        )}
      >
        <Icon name={icon} size={compact ? "md" : "lg"} />
      </span>
      <div className={cn("flex min-w-0 flex-col gap-1", compact && "flex-1")}>{text}</div>
      {action === null ? null : <div className={cn("flex", !compact && "pt-1")}>{action}</div>}
    </div>
  );
}
