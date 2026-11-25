import { useState } from "react";

import { automaticColorOf } from "../lib/automatic-color";
import { initialsOf } from "../lib/initials";
import { paletteTile } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { tileClasses } from "../lib/tile";
import type { TileCorners, TileSize } from "../lib/tile";
import { cn } from "../lib/utils";

export type AvatarProps = {
  /** The name it stands beside: its initials, and its colour until one is picked. */
  name: string;
  /** The logo's address, when there is one; the initials show if it is missing or fails. */
  src?: string;
  /** The colour picked from the palette; `null` or left out: the name's automatic colour. */
  color?: PaletteColor | null;
  /** The same sizes as `CategoryIcon`: 24, 32 (the default) or 40 px. */
  size?: TileSize;
  /** `rounded` (the default): a square with rounded corners; or `round`. */
  corners?: TileCorners;
};

/**
 * What a component that names something draws its avatar from, beside the name it shows: the name
 * the initials come from, the logo and the colour picked.
 */
export type AvatarFace = Pick<AvatarProps, "name" | "src" | "color">;

/**
 * A logo, or the name's initials in a colour of the palette on its tint (the palette's tile): the
 * one picked, else the name's automatic one (stable, never random). Decorative: the name sits beside it, so it is hidden from
 * screen readers and the image's `alt` is empty. The image loads lazily; if it fails, the
 * initials take its place, also when it failed before the page hydrated (no `error` event comes
 * then: the image is read when it mounts).
 *
 * Motion: none of its own; it does not move.
 */
export function Avatar({ name, src, color, size = "md", corners = "rounded" }: AvatarProps) {
  const [failed, setFailed] = useState<string>();
  const showImage = src !== undefined && src !== failed;
  const shown = color ?? automaticColorOf(name);

  return (
    <span
      data-slot="avatar"
      data-color={shown}
      data-fallback={!showImage || undefined}
      aria-hidden="true"
      className={cn(
        tileClasses(size, corners),
        showImage ? "bg-muted" : paletteTile[shown],
        "font-medium",
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          ref={(image) => {
            // Already settled without a picture: it failed before React listened.
            if (image !== null && image.complete && image.naturalWidth === 0) {
              setFailed(src);
            }
          }}
          onError={() => setFailed(src)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
