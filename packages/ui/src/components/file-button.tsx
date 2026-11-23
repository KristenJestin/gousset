import { useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";

import { Button } from "./button";
import type { ButtonSize, ButtonVariant } from "./button";
import type { IconName } from "./icon";

export type FileButtonProps = {
  /** The button's label, in the page's words ("Import a profile file"). */
  children: ReactNode;
  /** The file picker's filter, as `<input accept>` takes it (".json"). */
  accept?: string;
  /** Called with the file chosen; choosing the same file again calls it again. */
  onFile: (file: File) => Promise<void> | void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** While the file is being handled: as `Button`'s. */
  loading?: boolean;
  disabled?: boolean;
};

/**
 * A button that opens the file picker for one file: for a setting's file (a profile to import),
 * where a drop zone (`FileDrop`) would be too much. The picker's input is hidden; the button is the
 * way in for the keyboard and screen readers.
 *
 * Motion: `Button`'s own; none of its own.
 */
export function FileButton({
  children,
  accept,
  onFile,
  variant = "secondary",
  size,
  icon,
  loading,
  disabled = false,
}: FileButtonProps) {
  const input = useRef<HTMLInputElement>(null);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.currentTarget.files ?? [];

    // Emptied, so that choosing the same file again is a change too.
    event.currentTarget.value = "";

    if (file !== undefined) {
      void onFile(file);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={loading}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        data-slot="file-button-input"
        className="sr-only"
        onChange={pick}
      />
    </>
  );
}
