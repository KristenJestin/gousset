import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import { formatMoney } from "../lib/money";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** A statement balance that disagrees, shown under the headline check. */
export type EarlierMismatch = { day: string; app: Money; statement: Money; difference: Money };

export type BalanceCheckProps =
  | { state: "no-statement" }
  | {
      state: "agrees";
      app: Money;
      statement: Money;
      day: string;
      /** Earlier statement balances that disagree, even though the latest one agrees. */
      earlierMismatches?: ReadonlyArray<EarlierMismatch>;
    }
  | {
      state: "disagrees";
      app: Money;
      statement: Money;
      day: string;
      difference: Money;
      earlierMismatches?: ReadonlyArray<EarlierMismatch>;
    };

/**
 * The account page's balance check (docs/wireframes, screen 7, note 2): the app's balance against
 * the latest statement's, on the day it covers; a mismatch shows the difference. With no statement
 * yet (a fresh account, or a balance-mode one with nothing noted), a plain sentence instead. An
 * earlier statement balance that disagrees is listed below, even once the latest one agrees, so a
 * past mismatch is never hidden.
 *
 * Motion: its result fades in (200 ms) once known. Cut under reduced motion.
 */
export function BalanceCheck(props: BalanceCheckProps) {
  const messages = useUiMessages().accounts;
  const locale = usePageLanguage();

  if (props.state === "no-statement") {
    return (
      <p
        data-slot="balance-check"
        className="animate-in fade-in text-sm text-muted-foreground duration-200"
      >
        {messages.balanceNoStatement}
      </p>
    );
  }

  const agrees = props.state === "agrees";
  const app = formatMoney(props.app, { locale });
  const statement = formatMoney(props.statement, { locale });

  const sentence = agrees
    ? messages.balanceAgrees(app, statement, props.day)
    : messages.balanceDisagrees(
        app,
        statement,
        props.day,
        formatMoney(props.difference, { locale, sign: "always" }),
      );

  const earlierMismatches = props.earlierMismatches ?? [];

  return (
    <div
      data-slot="balance-check"
      data-state={props.state}
      className="flex animate-in items-start gap-2 fade-in rounded-lg border p-3 duration-200"
    >
      <span className={cn("flex shrink-0", agrees ? "text-money-income" : "text-destructive")}>
        <Icon name={agrees ? "success" : "warning"} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {agrees ? messages.balanceChecked : messages.balanceMismatch}
        </p>
        <p className="text-sm text-muted-foreground">{sentence}</p>
        {earlierMismatches.length === 0 ? null : (
          <div className="flex flex-col gap-1 pt-1" data-slot="balance-check-earlier">
            <p className="text-sm font-medium text-foreground">{messages.balanceAlsoDiffers}</p>
            <ul className="flex flex-col gap-1">
              {earlierMismatches.map((entry) => (
                <li key={entry.day} className="text-sm text-muted-foreground">
                  {messages.balanceDisagrees(
                    formatMoney(entry.app, { locale }),
                    formatMoney(entry.statement, { locale }),
                    entry.day,
                    formatMoney(entry.difference, { locale, sign: "always" }),
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** `BalanceCheck` on its way: its box, at the same height as a result. */
export function BalanceCheckSkeleton() {
  return (
    <SkeletonFrame>
      <div className="flex items-start gap-2 rounded-lg border p-3">
        <Skeleton className="size-4 shrink-0 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
    </SkeletonFrame>
  );
}
