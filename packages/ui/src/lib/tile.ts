import { cn } from "./utils";

/** The sizes a category icon and an avatar share, so they line up in the same rows. */
export type TileSize = "sm" | "md" | "lg";

/** `round`: a circle; `rounded`: a square with rounded corners. */
export type TileCorners = "round" | "rounded";

/** A small tile's box: 24, 32 or 40 px. */
export function tileClasses(size: TileSize, corners: TileCorners) {
  return cn(
    "inline-grid shrink-0 place-items-center overflow-hidden select-none",
    size === "sm" && "size-6 text-xs",
    size === "md" && "size-8 text-xs",
    size === "lg" && "size-10 text-sm",
    corners === "round" ? "rounded-full" : "rounded-md",
  );
}
