// The one way pages tell the user what happened (#7, "Toasts"): the wording, the durations and the
// kinds live here, so a saved change, a failure or an undo reads and behaves the same everywhere.
// It needs no React: a page, a mutation's callback or a job's listener call it as it is. The app
// mounts `<Toaster />` (components/toaster.tsx) once, which shows this queue.
//
// The words come from the `notify` section of `messages.ts`, in the page's language (`<html
// lang>`), read at each call. What names the user's data ("12 lines added", a merchant) comes from
// the caller, already translated, as `title` or `description`.

import { createToaster } from "@ui-sdk/react/toast";

import { pageMessages } from "./messages";

/** How long a toast stays on screen, in ms, while nothing pauses it. Errors stay until dismissed. */
export const NOTIFY_DURATION = {
  /** A success, a resolved progress: long enough to read one short line. */
  brief: 4000,
  /** A toast with an action (Undo): two more seconds to reach its button. */
  withAction: 6000,
} as const;

/**
 * The queue `<Toaster />` shows. Pages call `notify`, never this: it is exported for the toaster
 * and the stories.
 */
export const toaster = createToaster<string>({ duration: NOTIFY_DURATION.brief });

/** What a toast says, naming the user's data, already in the page's language. */
export type NotifyText = {
  title?: string;
  description?: string;
};

/** Runs again what failed; a promise keeps the button busy until it settles. */
export type NotifyRetry = () => Promise<void> | void;

export type NotifyFailure = {
  /** What failed or why, naming the user's data ("statement.ofx could not be read"). */
  description?: string;
  /** Adds a Retry button; the toast closes once it resolves. */
  retry?: NotifyRetry;
  /** Turns the toast with this id into the error, in place. */
  id?: string;
};

/** A progress toast, to move on and resolve in place. */
export type ProgressToast = {
  id: string;
  /** New words while it runs ("Reading 3 of 5"). False once the toast was dismissed. */
  update: (text: NotifyText) => boolean;
  /** Resolves it to a success ("12 lines added"), in place; nothing if it was dismissed. */
  succeed: (text?: NotifyText) => void;
  /** Resolves it to an error, in place; shown again even if it was dismissed. */
  fail: (failure?: Omit<NotifyFailure, "id">) => void;
};

export type NotifyUndo = {
  /** What was just done ("Line approved"). */
  title: string;
  description?: string;
  /** Takes it back. The same toast then says Undone, or that it could not. */
  onUndo: () => Promise<void> | void;
  id?: string;
};

let made = 0;

function newId() {
  made += 1;

  return `notify-${made}`;
}

function retryAction(retry: NotifyRetry | undefined) {
  return retry === undefined
    ? undefined
    : { label: pageMessages().notify.retry, onAction: () => retry() };
}

function failed({ description, retry, id }: NotifyFailure = {}): string {
  return toaster.error({
    id,
    title: pageMessages().notify.failed,
    description,
    duration: Infinity,
    action: retryAction(retry),
  });
}

function progress(id: string, text: NotifyText = {}): ProgressToast {
  toaster.loading({
    id,
    title: text.title ?? pageMessages().notify.working,
    description: text.description,
    duration: Infinity,
    action: undefined,
  });

  return {
    id,
    update: (next) =>
      toaster.update(id, {
        title: next.title ?? pageMessages().notify.working,
        description: next.description,
      }),
    succeed: (next = {}) => {
      // An update, not an add: a progress the user dismissed stays closed.
      toaster.update(id, {
        type: "success",
        title: next.title ?? pageMessages().notify.done,
        description: next.description,
        duration: NOTIFY_DURATION.brief,
      });
    },
    // An add by id: an error is shown even if the progress was dismissed.
    fail: (failure = {}) => {
      failed({ ...failure, id });
    },
  };
}

function undo({ title, description, onUndo, id = newId() }: NotifyUndo): string {
  const messages = pageMessages().notify;

  // The action keeps the toast (`dismiss: false`) and turns it into the outcome, in place.
  const run = async () => {
    try {
      await onUndo();
    } catch {
      toaster.update(id, {
        type: "error",
        title: messages.undoFailed,
        description,
        duration: Infinity,
        action: { label: messages.retry, dismiss: false, onAction: run },
      });

      return;
    }

    toaster.update(id, {
      type: "success",
      title: messages.undone,
      description,
      duration: NOTIFY_DURATION.brief,
      action: undefined,
    });
  };

  return toaster.success({
    id,
    title,
    description,
    duration: NOTIFY_DURATION.withAction,
    action: { label: messages.undo, dismiss: false, onAction: run },
  });
}

/**
 * Toasts, the same everywhere. Each call returns the toast's id.
 *
 * - `notify.saved()`: "Saved", 4 s. `{ description }` names what was saved.
 * - `notify.failed({ description, retry })`: "Something went wrong", announced assertively, stays
 *   until dismissed; `retry` adds a Retry button.
 * - `notify.progress(id, { title })`: a loader and the caller's words, until resolved in place with
 *   `.succeed({ title: "12 lines added" })` or `.fail({ retry })`. Calling it again with the same id
 *   updates the same toast.
 * - `notify.undo({ title: "Line approved", onUndo })`: an Undo button for 6 s; the same toast then
 *   says Undone, or Couldn't undo with Retry.
 * - `notify.dismiss(id)` closes one, `notify.dismiss()` every one.
 */
export const notify = {
  saved: ({ description, id }: { description?: string; id?: string } = {}): string =>
    toaster.success({
      id,
      title: pageMessages().notify.saved,
      description,
      duration: NOTIFY_DURATION.brief,
      action: undefined,
    }),
  failed,
  progress,
  undo,
  dismiss: (id?: string) => {
    toaster.dismiss(id);
  },
};
