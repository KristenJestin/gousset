import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { Amount, AmountSkeleton } from "./amount";
import { Chip } from "./chip";
import { Icon } from "./icon";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type MovementRow = {
  id: string;
  /** Who paid, or the account the money left. */
  from: string;
  /** The account the money arrived on. */
  to: string;
  /** What it is, after the accounts, in the user's words: "Salary". */
  note?: string;
  amount: Money;
  /** The securities it bought on the account it reached, and for how much. */
  bought?: { name: string; amount: Money };
  /**
   * Maybe a refund (#208): money back that may cancel a purchase, no income until the user
   * answers. A "Maybe a refund" chip after the accounts, in place of a note.
   */
  maybeRefund?: boolean;
};

export type MovementListProps = {
  movements: ReadonlyArray<MovementRow>;
  /** What the list is, for screen readers. */
  label: string;
  /** What an empty month says, in the page's words. */
  emptyText: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

function Arrow() {
  return (
    <span className="flex shrink-0 text-muted-foreground">
      <Icon name="next" size="sm" />
    </span>
  );
}

/**
 * The month's movements between the user's own accounts, and what came in (docs/wireframes,
 * screen 1, block 3): one "from → to" row each, the account reached in bold, its amount at the
 * end. A row is one line, its names cut short when they do not fit: every row has the same
 * height, so that the skeleton takes their exact place. A transfer followed by a purchase of securities fits on one row: "→ buy World index ETF",
 * its amount "€350 → €335". Neither spending nor income: no colour. Money back that may be a
 * refund (#208) is flagged "Maybe a refund": the month's received leaves it out until answered.
 *
 * Motion: when the month changes, the amounts roll (200 ms, ease-out); cut under reduced motion.
 * The "Maybe a refund" chip has none of its own: it comes and goes with its row, at once.
 */
export function MovementList({ movements, label, emptyText, locale }: MovementListProps) {
  const all = useUiMessages();
  const messages = all.money;

  if (movements.length === 0) {
    return <p className="flex h-10 items-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul aria-label={label} data-slot="movement-list" className="flex flex-col divide-y">
      {movements.map((movement) => (
        <li key={movement.id} className="flex h-10 items-center gap-3 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate">{movement.from}</span>
            <Arrow />
            <span className="truncate font-medium">{movement.to}</span>
            {movement.bought === undefined ? null : (
              <>
                <Arrow />
                <span className="truncate">{messages.bought(movement.bought.name)}</span>
              </>
            )}
            {movement.note === undefined ? null : (
              <span className="truncate text-muted-foreground">({movement.note})</span>
            )}
            {movement.maybeRefund === true ? (
              <span data-slot="maybe-refund" className="flex shrink-0">
                <Chip>{all.operations.maybeRefund}</Chip>
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Amount value={movement.amount} whole size="sm" locale={locale} />
            {movement.bought === undefined ? null : (
              <>
                <Arrow />
                <Amount value={movement.bought.amount} whole size="sm" locale={locale} />
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** `MovementList` on its way: as many rows as it will show (four by default), same heights. */
export function MovementListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <ul className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex h-10 items-center gap-3">
            <span className="flex flex-1">
              <Skeleton className="h-4 w-48 max-w-full" />
            </span>
            <AmountSkeleton size="sm" />
          </li>
        ))}
      </ul>
    </SkeletonFrame>
  );
}
