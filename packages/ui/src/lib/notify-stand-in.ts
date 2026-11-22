// TODO(#7): replaced by `@gousset/ui/lib/notify`, whose names these are: the swap changes the
// import path only. The smallest stand-in: what pages call to tell the user something happened,
// read by `Toaster` (`../components/toaster-stand-in`).

export type Toast = { id: string; description?: string; retry?: () => void };

const noToasts: ReadonlyArray<Toast> = [];
let toasts = noToasts;
let lastId = 0;
const listeners = new Set<() => void>();

function publish(next: ReadonlyArray<Toast>) {
  toasts = next;

  for (const listener of listeners) {
    listener();
  }
}

/** For `Toaster`: follows the toasts shown. */
export const toastStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
  current: () => toasts,
  none: () => noToasts,
};

/** Toasts, the same everywhere. Each call returns the toast's id. */
export const notify = {
  /**
   * Something the user did was refused or failed: "Something went wrong", stays until dismissed;
   * `retry` adds a Retry button. The same id replaces the toast in place.
   */
  failed: ({
    description,
    retry,
    id,
  }: { description?: string; retry?: () => void; id?: string } = {}): string => {
    lastId += 1;

    const toastId = id ?? `toast-${lastId}`;

    publish([
      ...toasts.filter((toast) => toast.id !== toastId),
      { id: toastId, description, retry },
    ]);

    return toastId;
  },

  /** Closes one toast, or every one. */
  dismiss: (id?: string) => {
    publish(id === undefined ? noToasts : toasts.filter((toast) => toast.id !== id));
  },
};
