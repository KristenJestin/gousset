import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A modal dialog on the native `<dialog>`: the browser traps focus, puts the rest of the page
 * out of reach and closes it on Escape; `onClose` then tells the page. The smallest one Gousset
 * needs until the base components are built on ui-sdk (issue #7), which may replace it.
 *
 * Motion: it fades in and grows from 95 % in 150 ms, easing out, cut when the system asks for
 * reduced motion. It closes at once: an exit fade would need `display` itself to transition.
 */
export interface DialogProps {
  /** Whether it is open; the page owns the state. */
  readonly open: boolean;
  /** Called when it closes on its own: Escape, or its close button. */
  readonly onClose: () => void;
  readonly title: ReactNode;
  /** A sentence under the title. */
  readonly description?: ReactNode;
  /** The close button's label, from the messages. */
  readonly closeLabel: string;
  readonly children?: ReactNode;
}

export function Dialog({ open, onClose, title, description, closeLabel, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // `<dialog>` opens as a modal only through `showModal()`: the `open` attribute would make it a
  // plain, non-modal box.
  useEffect(() => {
    const dialog = ref.current;

    if (dialog === null) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onClose={onClose}
      className="m-auto w-full max-w-md scale-95 rounded-xl border-none bg-popover p-6 text-popover-foreground opacity-0 shadow-lg transition duration-150 ease-out backdrop:bg-foreground/20 open:scale-100 open:opacity-100 motion-reduce:transition-none starting:open:scale-95 starting:open:opacity-0"
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description === undefined ? null : (
                <p id={descriptionId} className="text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {closeLabel}
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
