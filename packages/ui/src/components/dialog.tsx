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
import type { FormEvent, ReactElement, ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { backdropClasses, dialogClasses } from "../lib/overlay-classes";
import { cn } from "../lib/utils";
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
  /**
   * The dialog holds a form: the body (its fields, one under the other) and the actions are one
   * `<form>`, sent by the submit `Button` among the actions or by Enter in a field, and Cancel
   * comes before the actions. The dialog stays open until the page closes it (`open`), so that a
   * refusal shows under its field.
   */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** With `onSubmit`: something was typed in the form (to take a refusal away). */
  onInput?: () => void;
  /**
   * With `onSubmit`: the form is being sent. Nothing closes the dialog meanwhile (a press on the
   * backdrop, Escape, the close button, Cancel), so that the answer lands on the form that sent it.
   */
  sending?: boolean;
  /** The element that opens it, forwarding its props and ref (a `Button`); or control `open`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A focused task over the page, on ui-sdk's `Dialog`: a title, a description, a body, actions and
 * a close button. Modal: focus stays inside, the page behind is inert and dimmed by the backdrop;
 * Escape, the close button or a press on the backdrop closes it (not while its form is `sending`),
 * and focus returns to what opened it. An action that asks for input is a button opening one,
 * holding the form (`onSubmit`); docs/design.md, "Actions and forms".
 *
 * On a phone (below 768 px) it is a sheet: along the screen's bottom edge, its whole width.
 *
 * Motion: the dialog fades and grows from 96 % in 200 ms, ease-out, and leaves in 150 ms, ease-in;
 * on a phone it rises from the bottom edge in 300 ms and goes back down in 200 ms. The backdrop
 * fades in and out in 200 ms. Cut under reduced motion.
 */
export function Dialog({
  title,
  description,
  children,
  actions,
  onSubmit,
  onInput,
  sending = false,
  trigger,
  open,
  onOpenChange,
}: DialogProps) {
  const body = (
    <>
      {children === undefined ? null : (
        // A form's fields one under the other, as `Form` lays them out on a page.
        <div className={cn("mt-4 text-sm", onSubmit !== undefined && "flex flex-col gap-4")}>
          {children}
        </div>
      )}
      {onSubmit === undefined ? (
        actions === undefined ? null : (
          <DialogActions>{actions}</DialogActions>
        )
      ) : (
        <DialogActions>
          <CancelButton disabled={sending} />
          {actions}
        </DialogActions>
      )}
    </>
  );

  return (
    <DialogRoot open={open} dismissible={!sending} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger === undefined ? null : <DialogTrigger render={trigger} />}
      <DialogBackdrop className={backdropClasses} />
      {/* Focus starts on the dialog itself: reading starts at the title, and Escape closes it at
          once (on the close button, its tooltip would take the first Escape). */}
      <DialogContent initialFocus="content" className={dialogClasses}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            {description === undefined ? null : (
              <DialogDescription className="text-sm text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </div>
          <CloseButton disabled={sending} />
        </div>
        {onSubmit === undefined ? (
          body
        ) : (
          <form className="flex flex-col" onSubmit={onSubmit} onInput={() => onInput?.()}>
            {body}
          </form>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

/** The corner's close button: an `IconButton` named "Close", in the page's language. */
function CloseButton({ disabled }: { disabled: boolean }) {
  const messages = useUiMessages();

  return (
    <DialogClosePart
      render={
        <IconButton icon="close" label={messages.overlays.close} size="sm" disabled={disabled} />
      }
    />
  );
}

/** A form dialog's Cancel, in the page's language: closes it, sending nothing. */
function CancelButton({ disabled }: { disabled: boolean }) {
  const messages = useUiMessages();

  return (
    <DialogClosePart
      render={
        <Button variant="ghost" disabled={disabled}>
          {messages.overlays.cancel}
        </Button>
      }
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
 * Motion: as `Dialog`, over the same backdrop. Cut under reduced motion.
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
          <AlertDialogClose render={<Button variant="ghost">{messages.overlays.cancel}</Button>} />
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
