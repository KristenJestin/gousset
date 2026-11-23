import { useId, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";

export type FileDropProps = {
  /** What to drop, in the page's words ("Drop your statements here"). */
  label: string;
  /** What it takes ("OFX, QIF, CAMT.053, MT940 or CSV"). */
  description?: string;
  /** The file picker's filter, as `<input accept>` takes it (".ofx,.qif,.xml,.sta,.csv"). */
  accept?: string;
  /** Called once per drop or pick, with every file of it. */
  onFiles: (files: ReadonlyArray<File>) => void;
  disabled?: boolean;
};

/** Whether what is dragged holds files (and not a link or text from the page). */
function carriesFiles(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Where statement files come in: dropped on the zone, or chosen with its button, which opens the
 * file picker (the keyboard's and screen readers' way in: the zone is not the only one). Either
 * way `onFiles` is called once, with every file. The picker keeps to `accept`; a drop takes what
 * it is given, so the page still checks each file's format.
 *
 * Motion: while files are dragged over it, the zone's border and background change in 150 ms
 * (ease-out) to show it takes them; cut under reduced motion.
 */
export function FileDrop({ label, description, accept, onFiles, disabled = false }: FileDropProps) {
  const messages = useUiMessages().imports;
  const labelId = useId();
  const descriptionId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Entering a child of the zone leaves the zone itself: count the levels to know when it is out.
  const [depth, setDepth] = useState(0);
  const dragging = depth > 0 && !disabled;

  const enter = (event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) {
      return;
    }

    event.preventDefault();
    setDepth((levels) => levels + 1);
  };

  const over = (event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };

  const leave = (event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) {
      return;
    }

    setDepth((levels) => Math.max(0, levels - 1));
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDepth(0);

    const files = [...event.dataTransfer.files];

    if (!disabled && files.length > 0) {
      onFiles(files);
    }
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];

    // Emptied, so that choosing the same file again is a change too.
    event.currentTarget.value = "";

    if (files.length > 0) {
      onFiles(files);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      data-slot="file-drop"
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onDragEnter={enter}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
      className={cn(
        "flex w-full flex-col items-center gap-4 rounded-lg border border-dashed border-input bg-card px-6 py-6 text-center",
        "transition-colors duration-150 ease-out",
        "sm:flex-row sm:text-left",
        "data-dragging:border-primary data-dragging:bg-muted",
        "data-disabled:opacity-50",
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon name="import" size="lg" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </p>
        {description === undefined ? null : (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        icon="add"
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onClick={() => input.current?.click()}
      >
        {messages.chooseFiles}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        data-slot="file-drop-input"
        className="sr-only"
        onChange={pick}
      />
    </div>
  );
}
