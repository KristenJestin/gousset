import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Button } from "./button";
import { Chip } from "./chip";
import { FormMessage } from "./form-message";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type AccountLineRow = {
  id: string;
  /** Already worded ("31 Oct."). */
  day: string;
  label: string;
  /** A short tag beside the label, already worded ("+ €28 MealCard"). */
  tag?: string;
  /** A transfer, which does not count: greyed, as the operations screen shows it. */
  muted?: boolean;
  amount: Money;
  /** The account's balance once this line is counted; left out on an account kept by its balance. */
  balanceAfter?: Money;
};

export type AccountLinesProps = {
  /** Newest first, as the page orders them. */
  rows: ReadonlyArray<AccountLineRow>;
  /** "Show older lines": left out, every line already shown is the account's lot. */
  onShowOlder?: () => void;
  /** While a page of older lines is loading: the button shows a spinner and is disabled. */
  loadingOlder?: boolean;
  /** Shown under the button when loading older lines failed. */
  olderError?: string;
  /** The page's own words for an empty account; a general sentence otherwise. */
  emptyText?: string;
  locale?: string;
};

/**
 * An account's lines (docs/wireframes, screen 7, block 5): the day, the label, the amount and the
 * balance once it is counted, newest first. `onShowOlder` adds a button under the list.
 */
export function AccountLines({
  rows,
  onShowOlder,
  loadingOlder,
  olderError,
  emptyText,
  locale,
}: AccountLinesProps) {
  const messages = useUiMessages();
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  if (rows.length === 0) {
    return (
      <p data-slot="account-lines" className="flex h-10 items-center text-sm text-muted-foreground">
        {emptyText ?? messages.accounts.noLines}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul data-slot="account-lines" className="flex flex-col divide-y">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              "flex h-12 items-center gap-3 text-sm",
              row.muted && "text-muted-foreground",
            )}
          >
            <span className="w-16 shrink-0 text-muted-foreground">{row.day}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{row.label}</span>
              {row.tag === undefined ? null : <Chip>{row.tag}</Chip>}
            </span>
            <span className="w-24 shrink-0 text-right">
              <Amount value={row.amount} size="sm" locale={writtenIn} />
            </span>
            <span className="w-24 shrink-0 text-right text-muted-foreground">
              {row.balanceAfter === undefined ? null : (
                <Amount value={row.balanceAfter} size="sm" locale={writtenIn} roll={false} />
              )}
            </span>
          </li>
        ))}
      </ul>
      {onShowOlder === undefined ? null : (
        <div className="flex flex-col items-start gap-2">
          <Button variant="secondary" size="sm" onClick={onShowOlder} loading={loadingOlder}>
            {messages.accounts.showOlderLines}
          </Button>
          <FormMessage message={olderError} />
        </div>
      )}
    </div>
  );
}

/** `AccountLines` on its way: as many rows as the loaded block shows, at the same height. */
export function AccountLinesSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex h-12 items-center gap-3">
            <Skeleton className="h-3.5 w-10 shrink-0" />
            <Skeleton className="h-3.5 min-w-0 flex-1" />
            <Skeleton className="h-3.5 w-16 shrink-0" />
            <Skeleton className="h-3.5 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}
