import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Chip } from "./chip";
import { Icon } from "./icon";
import { Skeleton, SkeletonFrame } from "./skeleton";

// The accounts overview (docs/wireframes, screen 3): the four totals, the accounts grouped under
// them, and the closed ones apart. Rows are plain flex rows, not an HTML `<table>`, like the rest
// of packages/ui's lists (`List`, `Breakdown`): a row is a single link, which a `<tr>` cannot be.

/** The accounts page's four groups, fixed by the account's kind (docs/data-model.md). */
export type AccountGroupId = "available" | "restricted" | "invested" | "owed";

/** Whether an account's lines are imported one by one, or only its balance is noted. */
export type AccountTrackingMode = "lines" | "balance";

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
  ref?: Ref<HTMLAnchorElement>;
};

/** A handful of steps so a short list staggers without naming an exact delay per row. */
const STAGGER_DELAYS = [
  "",
  "delay-75",
  "delay-100",
  "delay-150",
  "delay-200",
  "delay-300",
] as const;

function staggerDelay(index: number) {
  return STAGGER_DELAYS[index % STAGGER_DELAYS.length];
}

/** A hatched chip behind restricted money (docs/design.md, "Hatching for money apart"). */
function RestrictedAmount({
  value,
  size,
  locale,
}: {
  value: Money;
  size: "sm" | "lg";
  locale: string;
}) {
  return (
    <span className="inline-flex items-center rounded-md bg-hatched-restricted px-1.5 py-0.5">
      <Amount value={value} size={size} whole={size === "lg"} locale={locale} roll={false} />
    </span>
  );
}

export type AccountRowProps = AnchorProps & {
  /** As the user calls the account: "Current account". */
  name: string;
  /** The envelope's words, already translated ("PEA", "Life insurance", "Livret A"). */
  envelope?: string;
  institution?: string;
  tracking: AccountTrackingMode;
  /** How far its statements go, already worded ("31 Oct.", "noted on 26 Oct."); `null` for none yet. */
  through?: string | null;
  /** The import lags behind the month: a warning beside `through`. */
  behind?: boolean;
  balance: Money;
  /** In the restricted-use group: its balance is hatched, not a plain figure. */
  restricted?: boolean;
  /** Shown apart, muted, inside `ClosedAccounts`. */
  closed?: boolean;
  /** Slides in from the side instead of fading in with the rest of its group. */
  justCreated?: boolean;
  /** Its place among the group's rows, for the staggered entrance. */
  index?: number;
};

/**
 * One account, a single link to its page (the app wraps it with its router's link, as
 * `app-shell`'s `NavLink`): its name, its envelope when it has one, its institution, how it is
 * tracked, how far its statements go, and its balance.
 *
 * Motion: fades and slides up with its group on first paint (200 ms, staggered by `index`); with
 * `justCreated`, it slides in from the side instead (a newly added account). Cut under reduced
 * motion (the page's global rule).
 */
export function AccountRow({
  name,
  envelope,
  institution,
  tracking,
  through = null,
  behind = false,
  balance,
  restricted = false,
  closed = false,
  justCreated = false,
  index = 0,
  ...anchorProps
}: AccountRowProps) {
  const messages = useUiMessages();
  const locale = usePageLanguage();

  const trackingLabel =
    tracking === "lines" ? messages.accounts.trackingLines : messages.accounts.trackingBalance;

  return (
    <li
      className={cn(
        "fill-mode-both duration-200",
        justCreated
          ? "animate-in slide-in-from-left-2 fade-in"
          : cn("animate-in slide-in-from-bottom-1 fade-in", !closed && staggerDelay(index)),
      )}
    >
      <a
        {...anchorProps}
        className="-mx-2 flex h-14 items-center gap-3 rounded-md px-2 transition-colors duration-150 ease-out hover:bg-muted"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("truncate text-sm font-medium", closed && "text-muted-foreground")}>
            {name}
          </span>
          {envelope === undefined ? null : <Chip>{envelope}</Chip>}
        </span>
        <span className="hidden w-32 shrink-0 truncate text-sm text-muted-foreground sm:block">
          {institution}
        </span>
        <span className="hidden w-16 shrink-0 text-sm text-muted-foreground md:block">
          {trackingLabel}
        </span>
        <span className="hidden w-36 shrink-0 items-center gap-1 text-sm text-muted-foreground md:flex">
          <span className="truncate">{through ?? messages.accounts.noStatement}</span>
          {behind ? <Icon name="warning" size="sm" label={messages.accounts.importBehind} /> : null}
        </span>
        <span className="flex w-24 shrink-0 justify-end">
          {restricted ? (
            <RestrictedAmount value={balance} size="sm" locale={locale} />
          ) : (
            <Amount value={balance} size="sm" locale={locale} />
          )}
        </span>
      </a>
    </li>
  );
}

export type AccountGroupProps = {
  id: AccountGroupId;
  /** The group's heading, already translated ("Available", "Savings and investments"). */
  title: string;
  /** One amount per currency held in the group, never converted. */
  totals: ReadonlyArray<Money>;
  /** Its place among the overview's groups, for the staggered entrance. */
  index?: number;
  /** `AccountRow`s, in order. */
  children: ReactNode;
};

/**
 * One group of the accounts overview: its heading, its total (one figure per currency, hatched
 * for the restricted-use group), then its accounts.
 *
 * Motion: fades and slides up on first paint (200 ms, staggered by `index`). Cut under reduced
 * motion.
 */
export function AccountGroup({ id, title, totals, index = 0, children }: AccountGroupProps) {
  const locale = usePageLanguage();

  return (
    <section
      aria-label={title}
      data-slot="account-group"
      className={cn(
        "flex flex-col animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200",
        staggerDelay(index),
      )}
    >
      <header className="flex h-10 items-center justify-between gap-3 border-b">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="flex items-center gap-3">
          {totals.map((total) =>
            id === "restricted" ? (
              <RestrictedAmount key={total.currency} value={total} size="sm" locale={locale} />
            ) : (
              <Amount
                key={total.currency}
                value={total}
                whole
                size="sm"
                locale={locale}
                roll={false}
              />
            ),
          )}
        </span>
      </header>
      <ul className="flex flex-col divide-y">{children}</ul>
    </section>
  );
}

export type AccountsOverviewTotal = {
  id: AccountGroupId;
  /** Already translated ("Available", "Savings and investments", "Restricted use", "Loans"). */
  label: string;
  /** One amount per currency held in the group, never converted; a loan's total is negative. */
  amounts: ReadonlyArray<Money>;
};

/**
 * The four totals at the top of the accounts page: available, savings and investments, restricted
 * use (hatched) and loans, each as one figure per currency.
 *
 * Motion: each total fades and slides up on first paint (200 ms, staggered). Cut under reduced
 * motion.
 */
export function AccountsTotals({ totals }: { totals: ReadonlyArray<AccountsOverviewTotal> }) {
  const locale = usePageLanguage();

  return (
    <div data-slot="accounts-totals" className="flex flex-wrap gap-3">
      {totals.map((total, index) => (
        <div
          key={total.id}
          className={cn(
            "flex flex-col gap-1 rounded-lg border p-3 animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200",
            staggerDelay(index),
          )}
        >
          <span className="text-xs text-muted-foreground">{total.label}</span>
          <span className="flex flex-wrap items-baseline gap-2">
            {total.amounts.map((amount) =>
              total.id === "restricted" ? (
                <RestrictedAmount key={amount.currency} value={amount} size="lg" locale={locale} />
              ) : (
                <Amount
                  key={amount.currency}
                  value={amount}
                  whole
                  size="lg"
                  locale={locale}
                  roll={false}
                />
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The closed accounts, apart from the rest and collapsed by default (a native disclosure: no
 * script needed to open it).
 */
export function ClosedAccounts({ count, children }: { count: number; children: ReactNode }) {
  const messages = useUiMessages();

  return (
    <details data-slot="closed-accounts" className="group rounded-lg border">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm text-muted-foreground marker:hidden">
        <span className="flex transition-transform duration-150 ease-out group-open:rotate-180">
          <Icon name="expand" size="sm" />
        </span>
        {messages.accounts.closed(count)}
      </summary>
      <ul className="flex flex-col divide-y border-t px-3">{children}</ul>
    </details>
  );
}

/**
 * The accounts overview on its way: the totals' place and `groups` groups of `rows` rows each, at
 * the same heights as the loaded page.
 */
export function AccountsOverviewSkeleton({
  groups = 4,
  rows = 3,
}: {
  groups?: number;
  rows?: number;
}) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex w-40 flex-col gap-2 rounded-lg border p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
        {Array.from({ length: groups }, (_, group) => (
          <div key={group} className="flex flex-col gap-2">
            <div className="flex h-10 items-center justify-between border-b">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex flex-col divide-y">
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="flex h-14 items-center gap-3">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="hidden h-4 w-32 sm:block" />
                  <Skeleton className="hidden h-4 w-16 md:block" />
                  <Skeleton className="hidden h-4 w-32 md:block" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}
