import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import type { Money } from "../lib/money";
import { Amount, AmountSkeleton } from "./amount";
import { Delta } from "./delta";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type InvestmentRow = {
  id: string;
  /** The investment account: "Northbank PEA". */
  account: string;
  value: Money;
  /** What came out of the user's pocket into it so far. */
  netContributions: Money;
};

export type InvestmentListProps = {
  accounts: ReadonlyArray<InvestmentRow>;
  /** What the list is, for screen readers. */
  label: string;
  /** What a user without investments reads, in the page's words. */
  emptyText: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * The investment accounts at the end of the month (docs/wireframes, screen 1, block 4): one row
 * each: its value, its gain against the net contributions, and that gain as a percentage, green
 * or red. The detail lives in Investments.
 *
 * Motion: when the month changes, the value rolls (200 ms, ease-out); cut under reduced motion.
 */
export function InvestmentList({ accounts, label, emptyText, locale }: InvestmentListProps) {
  const messages = useUiMessages().money;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  if (accounts.length === 0) {
    return <p className="flex h-10 items-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul aria-label={label} data-slot="investment-list" className="flex flex-col divide-y">
      {accounts.map((account) => (
        <li key={account.id} className="flex h-10 items-center gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate">{account.account}</span>
          <Amount value={account.value} whole size="sm" locale={writtenIn} />
          <span className="flex w-20 shrink-0 justify-end text-muted-foreground">
            <Amount
              value={{
                ...account.value,
                minor: account.value.minor - account.netContributions.minor,
              }}
              whole
              sign="always"
              size="sm"
              locale={writtenIn}
            />
          </span>
          <span className="flex w-14 shrink-0 justify-end">
            <Delta
              value={account.value}
              reference={account.netContributions}
              referenceLabel={messages.putIn}
              meaning="savings"
              locale={writtenIn}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** `InvestmentList` on its way: one row by default, same height. */
export function InvestmentListSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <ul className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex h-10 items-center gap-3">
            <span className="flex flex-1">
              <Skeleton className="h-4 w-32" />
            </span>
            <AmountSkeleton size="sm" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-14" />
          </li>
        ))}
      </ul>
    </SkeletonFrame>
  );
}
