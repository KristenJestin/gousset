import {
  AlertDialog as AlertDialogRoot,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";
import {
  Dialog as DialogRoot,
  DialogBackdrop,
  DialogClose as DialogClosePart,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { backdropClasses, dialogClasses } from "../lib/overlay-classes";
import { Button } from "./button";
import { IconButton } from "./icon-button";

export type DialogProps = {
  /** Names the dialog, at its top. */
  title: string;
  /** A sentence under the title saying what the dialog is for. */
  description?: string;
  /** The body. */
  children?: ReactNode;
  /** `Button`s at the bottom, the main one last; wrap one in `DialogClose` to close with it. */
  actions?: ReactNode;
  /** The element that opens it, forwarding its props and ref (a `Button`); or control `open`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A focused task over the page, on ui-sdk's `Dialog`: a title, a description, a body, actions and
 * a close button. Modal: focus stays inside, the page behind is inert; Escape, the close button
 * or a press outside closes it, and focus returns to what opened it.
 *
 * Motion: the dialog fades and grows in 200 ms, ease-out, the page behind veils in 200 ms; both
 * leave the same way. Cut under reduced motion.
 */
export function Dialog({
  title,
  description,
  children,
  actions,
  trigger,
  open,
  onOpenChange,
}: DialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger === undefined ? null : <DialogTrigger render={trigger} />}
      <DialogBackdrop className={backdropClasses} />
      <DialogContent className={dialogClasses}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            {description === undefined ? null : (
              <DialogDescription className="text-sm text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </div>
          <CloseButton />
        </div>
        {children === undefined ? null : <div className="mt-4 text-sm">{children}</div>}
        {actions === undefined ? null : <DialogActions>{actions}</DialogActions>}
      </DialogContent>
    </DialogRoot>
  );
}

/** The corner's close button: an `IconButton` named "Close", in the page's language. */
function CloseButton() {
  const messages = useUiMessages();

  return (
    <DialogClosePart
      render={<IconButton icon="close" label={messages.overlays.close} size="sm" />}
    />
  );
}

function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
  );
}

/** Makes one of the dialog's actions close it, like Cancel: `<DialogClose><Button …/></DialogClose>`. */
export function DialogClose({ children }: { children: ReactElement }) {
  return <DialogClosePart render={children} />;
}

export type AlertDialogProps = {
  /** The question ("Delete this rule?"). */
  title: string;
  /** What happens if the user agrees. */
  description: string;
  /** The agreeing answer's label ("Delete"). */
  confirmLabel: string;
  /** Runs on the agreeing answer; a promise keeps the dialog open and the button busy until it settles. */
  onConfirm: () => Promise<void> | void;
  /** The agreeing answer deletes or cannot be undone: a destructive button. */
  destructive?: boolean;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A question that must be answered before going on, on ui-sdk's `AlertDialog`: Cancel and the
 * agreeing answer. A press outside does not close it; Escape and Cancel do. Focus starts on Cancel.
 *
 * Motion: as `Dialog`, 200 ms in and out. Cut under reduced motion.
 */
export function AlertDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  trigger,
  open,
  onOpenChange,
}: AlertDialogProps) {
  const messages = useUiMessages();
  // ui-sdk keeps the close pending, but its state does not reach our `Button`: track it here so
  // the button shows the loader and `aria-busy` like any other busy button.
  const [confirming, setConfirming] = useState(false);

  const confirm = async () => {
    setConfirming(true);

    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AlertDialogRoot open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger === undefined ? null : <AlertDialogTrigger render={trigger} />}
      <AlertDialogBackdrop className={backdropClasses} />
      <AlertDialogContent className={dialogClasses}>
        <AlertDialogTitle className="text-base font-semibold">{title}</AlertDialogTitle>
        <AlertDialogDescription className="mt-1 text-sm text-muted-foreground">
          {description}
        </AlertDialogDescription>
        <DialogActions>
          <AlertDialogClose
            render={<Button variant="secondary">{messages.overlays.cancel}</Button>}
          />
          <AlertDialogClose
            value="confirm"
            action={confirm}
            render={
              <Button variant={destructive ? "destructive" : "primary"} loading={confirming}>
                {confirmLabel}
              </Button>
            }
          />
        </DialogActions>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
