import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { Amount } from "./amount";
import { PaybackStateChip } from "./subject-payback";

// What the user still waits for (#217): the paid-back subjects not paid back yet, on the subjects
// screen under their tree.

/**
 * The paid-back subjects not paid back yet, under the subjects' tree (#217): a card of its own,
 * named by `label` ("Waiting to be paid back"), each row a link to its subject. The page leaves it
 * out when nothing is waited for.
 *
 * Motion: none of its own; see `PaybackWaitingItem`.
 */
export function PaybackWaiting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      data-slot="payback-waiting"
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground"
    >
      <h2 className="flex min-h-8 items-center ps-2 text-sm font-semibold">{label}</h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

export type PaybackWaitingItemProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "className" | "children"
> & {
  ref?: Ref<HTMLAnchorElement>;
  /** The subject's path, "Work > Lyon trip". */
  name: string;
  /** Who pays it back (not `from`: a router link's own prop). */
  payer: string;
  /** Where it stands (not `state`: a router link's own prop). */
  standing: "partly" | "asked" | "to_ask";
  /** The day it was asked, already worded ("4 May"). */
  askedOn?: string;
  /** Spent less paid back: what is still waited for. */
  waiting: Money;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * One subject waited for, in a `PaybackWaiting`: a link to its page (the app's router link,
 * `createLink`), its name and what is still waited for on the first line, who pays it back and
 * where it stands (`PaybackStateChip`) under it.
 *
 * Motion: its background shows on hover in 150 ms; the amount rolls to its new value in 200 ms
 * (`Amount`) when what came back changes. Cut under reduced motion.
 */
export function PaybackWaitingItem({
  name,
  payer,
  standing,
  askedOn,
  waiting,
  locale,
  ...props
}: PaybackWaitingItemProps) {
  const messages = useUiMessages().subjects;

  return (
    <li>
      <a
        {...props}
        data-slot="payback-waiting-row"
        className="flex flex-col gap-1 rounded-md px-2 py-2 text-sm transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
          <span className="flex shrink-0 flex-col items-end">
            <Amount value={waiting} size="sm" locale={locale} />
            <span className="sr-only">{messages.paybackWaiting}</span>
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{payer}</span>
          <PaybackStateChip state={standing} askedOn={askedOn} />
        </span>
      </a>
    </li>
  );
}
