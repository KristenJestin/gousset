import { useUiMessages } from "../hooks/use-ui-messages";
import { paletteTile } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { tileClasses } from "../lib/tile";
import type { TileCorners, TileSize } from "../lib/tile";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { CategoryIconName } from "./icon";

export type CategoryIconProps = {
  /**
   * The category's icon, as stored with it; `null` for a line without a category. A category with
   * no icon of its own is drawn with `other`'s.
   */
  icon: CategoryIconName | null;
  /**
   * The colour it is shown in (its own, else its parent's, #205): the tile takes its tint and the
   * icon its colour. None: a neutral tile.
   */
  color?: PaletteColor | null;
  /** `sm` 24 px in dense rows, `md` 32 px (the default), `lg` 40 px in a detail. */
  size?: TileSize;
  /** `round` (the default), or `rounded`: a square with rounded corners. */
  corners?: TileCorners;
  /**
   * Said to screen readers. Leave it out when the category's name sits beside it; the
   * uncategorised form says "Uncategorised" on its own.
   */
  label?: string;
};

/**
 * A category's icon on a small tile, tinted with the category's colour when it has one
 * (docs/design.md, "Icons": chosen in `icons.ts`, never an emoji). Without a category, a dashed
 * empty tile.
 */
export function CategoryIcon({
  icon,
  color = null,
  size = "md",
  corners = "round",
  label,
}: CategoryIconProps) {
  const messages = useUiMessages();
  const name = label ?? (icon === null ? messages.pieces.uncategorised : undefined);

  return (
    <span
      data-slot="category-icon"
      data-uncategorised={icon === null || undefined}
      data-icon={icon ?? undefined}
      data-color={icon === null || color === null ? undefined : color}
      role={name === undefined ? undefined : "img"}
      aria-label={name}
      aria-hidden={name === undefined ? true : undefined}
      className={cn(
        tileClasses(size, corners),
        icon === null
          ? "border border-dashed border-input text-muted-foreground"
          : color === null
            ? "bg-muted text-foreground"
            : paletteTile[color],
      )}
    >
      <Icon name={icon ?? "more"} size={size} />
    </span>
  );
}
