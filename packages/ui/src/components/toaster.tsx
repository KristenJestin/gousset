import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
} from "@ui-sdk/react/toast";
import type { ToastType } from "@ui-sdk/react/toast";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { buttonClasses } from "../lib/button-classes";
import { toaster } from "../lib/notify";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { Loader } from "./loader";

// Below Tailwind's `sm` (40rem) the toasts sit at the top, out of the thumb's way and above the
// bottom navigation; from `sm` up, at the bottom. The side also sets which way a swipe dismisses,
// so it is read here rather than only in CSS.
const PHONE = "(width < 40rem)";

function subscribeToWidth(onChange: () => void) {
  const media = window.matchMedia(PHONE);

  media.addEventListener("change", onChange);

  return () => media.removeEventListener("change", onChange);
}

function usePlacement(): "top" | "bottom" {
  const phone = useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

  return phone ? "top" : "bottom";
}

/** The toast's size and content: a spring, which retargets mid-flight without a jump. */
const spring = { type: "spring", visualDuration: 0.3, bounce: 0.15 } as const;

/**
 * The notifications, placed once by the app near the root of `<body>`: the queue `notify` fills
 * (`lib/notify.ts`), on ui-sdk's `ToastRegion`. At most three show; the stack expands on hover and
 * focus; F6 reaches it and Escape dismisses the focused toast. Bottom right on desktop, top on a
 * phone, above everything (the top layer, `z-50` where there is none).
 *
 * The stacking reads the heights ui-sdk measures (`--toast-*`, set through the CSSOM) in the
 * "Toasts" block of `globals.css`.
 */
export function Toaster() {
  const messages = useUiMessages().notify;
  const side = usePlacement();

  return (
    <ToastRegion
      toaster={toaster}
      side={side}
      align="end"
      maxVisible={3}
      aria-label={messages.region}
      pendingAnnouncement={messages.pending}
      className="z-50"
    >
      {(item) => (
        <ToastCard
          type={item.type}
          version={item.version}
          actionLabel={item.action?.label}
          dismissLabel={messages.dismiss}
        />
      )}
    </ToastRegion>
  );
}

function ToastCard({
  type,
  version,
  actionLabel,
  dismissLabel,
}: {
  type: ToastType;
  version: number;
  actionLabel: ReactNode;
  dismissLabel: string;
}) {
  return (
    <Toast
      className="rounded-lg border bg-popover text-sm text-popover-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      // The toasts hidden behind a collapsed stack are out of reach until it expands.
      render={(props, state) => (
        <li {...props} inert={state.leaving || (!state.expanded && state.index > 0)} />
      )}
    >
      <SpringHeight>
        <div className="flex items-start gap-3 py-3 pr-3 pl-4">
          <ToastMark type={type} />
          {/* A new version (an update in place) brings its words in softly. */}
          <motion.div
            key={version}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="min-w-0 flex-1 py-1.5"
          >
            <ToastTitle className="font-medium" />
            <ToastDescription className="mt-0.5 text-muted-foreground" />
          </motion.div>
          <ToastAction className={buttonClasses("secondary", "sm")}>
            {(state) => <ActionLabel pending={state.pending}>{actionLabel}</ActionLabel>}
          </ToastAction>
          <ToastClose
            aria-label={dismissLabel}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon name="close" />
          </ToastClose>
        </div>
      </SpringHeight>
    </Toast>
  );
}

/** The action's label, kept for its width while the loader runs over it. */
function ActionLabel({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <>
      <span className={cn(pending && "invisible")}>{children}</span>
      {pending ? (
        <span className="absolute inset-0 grid place-items-center">
          <Loader size="sm" />
        </span>
      ) : null}
    </>
  );
}

/** The kind's mark; a change of kind swaps it with a spring (the loader becomes a check). */
function ToastMark({ type }: { type: ToastType }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={type}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={spring}
          className={cn(
            "flex",
            type === "error" && "text-destructive",
            type === "success" && "text-primary",
            type !== "error" && type !== "success" && "text-muted-foreground",
          )}
        >
          <MarkDrawing type={type} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function MarkDrawing({ type }: { type: ToastType }) {
  switch (type) {
    case "loading": {
      return <Loader size="md" />;
    }

    case "success": {
      return <Icon name="success" />;
    }

    case "error": {
      return <Icon name="error" />;
    }

    case "warning": {
      return <Icon name="warning" />;
    }

    case "info":
    case "default": {
      return <Icon name="info" />;
    }
  }
}

/**
 * Follows its content's size with a spring: a toast that changes in place grows or shrinks
 * smoothly, and a second change mid-flight retargets from where it is. Motion's layout animation
 * moves it with transforms (no height animated, nothing reflows at each frame); the content keeps
 * its own shape (`layout="position"`). Motion sets the transforms through the CSSOM.
 */
function SpringHeight({ children }: { children: ReactNode }) {
  return (
    <motion.div layout transition={spring} className="overflow-hidden">
      <motion.div layout="position" transition={spring}>
        {children}
      </motion.div>
    </motion.div>
  );
}
