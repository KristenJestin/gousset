import { useId } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { dataUrlOf } from "../lib/data-url";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { FileButton } from "./file-button";

/** The images a logo may be: what the server recognises (PNG, JPEG, WebP); never SVG. */
const LOGO_TYPES = "image/png,image/jpeg,image/webp";

export type LogoFieldProps = {
  /** Names the field, shown above it, translated ("Logo"). */
  label: string;
  /** The name the logo stands for: the preview's initials and automatic colour. */
  name: string;
  /** The colour picked for the initials; `null` or left out: the name's automatic colour. */
  color?: PaletteColor | null;
  /** The logo shown: the saved one's address, or the preview of a file just picked. */
  src?: string;
  /**
   * Called with the file picked and its preview, a `data:` URL to pass back as `src` until it is
   * saved (`undefined` if the browser could not read it). The page checks it and uploads it.
   */
  onFile: (file: File, preview: string | undefined) => void;
  /** Takes the logo off; its button shows only while there is a logo (`src`). */
  onRemove?: () => void;
  /** A line of help under it, linked to it ("PNG, JPEG or WebP, 256 KiB at most"). */
  description?: string;
  /** Why the file was refused, under it, linked to it. */
  error?: string;
  disabled?: boolean;
};

/**
 * A logo to upload: the avatar it gives (40 px) beside "Choose a file", or "Replace" and
 * "Remove" once there is one. The file picker keeps to PNG, JPEG and WebP. The field only reports
 * the file and its preview; the page uploads it, and says under it why one was refused.
 *
 * Motion: none of its own; the buttons' own (colours in 150 ms, a slight press), cut under
 * reduced motion.
 */
export function LogoField({
  label,
  name,
  color,
  src,
  onFile,
  onRemove,
  description,
  error,
  disabled = false,
}: LogoFieldProps) {
  const messages = useUiMessages().logo;
  const labelId = useId();
  const descriptionId = useId();
  const errorId = useId();

  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter((id) => id !== undefined)
    .join(" ");

  const pick = async (file: File) => {
    let preview: string | undefined;

    try {
      preview = await dataUrlOf(file);
    } catch {
      // Unreadable here: the page still gets the file, and the avatar keeps its initials.
      preview = undefined;
    }

    onFile(file, preview);
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy === "" ? undefined : describedBy}
      data-slot="logo-field"
      data-invalid={error === undefined ? undefined : true}
      className="flex flex-col gap-1.5"
    >
      <span
        id={labelId}
        className={cn("text-sm font-medium text-foreground", disabled && "opacity-50")}
      >
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={name} src={src} color={color} size="lg" />
        <FileButton accept={LOGO_TYPES} size="sm" disabled={disabled} onFile={pick}>
          {src === undefined ? messages.choose : messages.replace}
        </FileButton>
        {src === undefined || onRemove === undefined ? null : (
          <Button variant="quiet" size="sm" disabled={disabled} onClick={onRemove}>
            {messages.remove}
          </Button>
        )}
      </div>
      {description === undefined ? null : (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
