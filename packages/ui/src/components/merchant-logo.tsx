import { useState } from "react";

import { initialsOf, toneIndexOf } from "../lib/merchant";
import { tileClasses } from "../lib/tile";
import type { TileCorners, TileSize } from "../lib/tile";
import { cn } from "../lib/utils";

export type MerchantLogoProps = {
  /** The merchant's name: its initials and its tile's tone come from it. */
  name: string;
  /** The logo's address, when there is one; the initials show if it is missing or fails. */
  src?: string;
  /** The same sizes as `CategoryIcon`: 24, 32 (the default) or 40 px. */
  size?: TileSize;
  /** `rounded` (the default): a square with rounded corners; or `round`. */
  corners?: TileCorners;
};

// A few tones, all theme tokens; a name always lands on the same one. Spent's orange is left
// out so a merchant's tile never reads as money spent or as an error.
const TONES = [
  "bg-muted text-foreground",
  "bg-chart-2/15 text-chart-2",
  "bg-chart-3/15 text-chart-3",
  "bg-chart-4/15 text-chart-4",
] as const;

/**
 * A merchant's logo, or its initials on a tile whose tone comes from its name (stable, never
 * random). Decorative: the merchant's name sits beside it, so the image's `alt` is empty. The
 * image loads lazily; if it fails, the initials take its place, also when it failed before the
 * page hydrated (no `error` event comes then: the image is read when it mounts).
 */
export function MerchantLogo({ name, src, size = "md", corners = "rounded" }: MerchantLogoProps) {
  const [failed, setFailed] = useState<string>();
  const showImage = src !== undefined && src !== failed;

  return (
    <span
      data-slot="merchant-logo"
      data-fallback={!showImage || undefined}
      aria-hidden="true"
      className={cn(
        tileClasses(size, corners),
        showImage ? "bg-muted" : TONES[toneIndexOf(name, TONES.length)],
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
