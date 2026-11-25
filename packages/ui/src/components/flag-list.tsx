import { Avatar } from "./avatar";
import type { AvatarFace } from "./avatar";
import { Icon } from "./icon";
import type { IconName } from "./icons";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type FlagRow = {
  id: string;
  /** What kind of thing it is: `up` for a price that rose, `import` for an account to import. */
  icon: IconName;
  /** The sentence, in the page's words: "Streamly goes from €8.99 to €9.49". */
  text: string;
  /** Who it is about, by logo or initials (a subscription's merchant, #204), after the icon. */
  avatar?: AvatarFace;
};

export type FlagListProps = {
  flags: ReadonlyArray<FlagRow>;
  /** What the list is, for screen readers. */
  label: string;
  /** What a month with nothing to point out says. */
  emptyText: string;
};

/**
 * What the review points out (docs/wireframes, screen 1, block 6): subscriptions whose price
 * changes or that stop, credits that expire, accounts not imported. One sentence each, after an
 * icon that says its kind, and the merchant's avatar (24 px, hidden from screen readers) when it is
 * about one; the page writes the sentences. No motion of its own.
 */
export function FlagList({ flags, label, emptyText }: FlagListProps) {
  if (flags.length === 0) {
    return <p className="flex h-10 items-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul aria-label={label} data-slot="flag-list" className="flex flex-col divide-y">
      {flags.map((flag) => (
        <li key={flag.id} className="flex min-h-10 items-center gap-3 py-2 text-sm">
          <span className="flex shrink-0 text-muted-foreground">
            <Icon name={flag.icon} size="sm" />
          </span>
          {flag.avatar === undefined ? null : (
            <Avatar
              name={flag.avatar.name}
              src={flag.avatar.src}
              color={flag.avatar.color}
              size="sm"
            />
          )}
          <span className="min-w-0">{flag.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** `FlagList` on its way: as many rows as it will show (two by default), same heights. */
export function FlagListSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <ul className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex min-h-10 items-center gap-3 py-2">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </li>
        ))}
      </ul>
    </SkeletonFrame>
  );
}
