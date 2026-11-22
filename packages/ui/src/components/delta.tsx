import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import { compare, formatMoney, formatPercent, isSteady } from "../lib/money";
import type { Comparison, Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Icon } from "./icon";

/** What the figure is: for spending, up is bad; for income and savings, up is good. */
export type DeltaMeaning = "spending" | "income" | "savings";

export type DeltaProps = {
  value: Money;
  reference: Money;
  /** What the reference is, in the page's words: "your 6-month average", "last month". */
  referenceLabel: string;
  meaning?: DeltaMeaning;
  /** `percent` (`+5%`) unless the reference is zero, then the amount (`+€80`). */
  show?: "percent" | "amount";
  /** Whole units for the amount, as in summaries. */
  whole?: boolean;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

type Trend = "up" | "down" | "steady";

function trendOf(comparison: Comparison): Trend {
  if (isSteady(comparison)) {
    return "steady";
  }

  return comparison.change.minor > 0 ? "up" : "down";
}

function DeltaText({
  comparison,
  asPercent,
  whole,
  locale,
}: {
  comparison: Comparison;
  asPercent: boolean;
  whole: boolean;
  locale: string;
}) {
  return asPercent && comparison.percent !== null
    ? formatPercent(comparison.percent, { locale, sign: "always" })
    : formatMoney(comparison.change, { locale, sign: "always", whole });
}

/**
 * A change against a reference, small and coloured by what it means: up is red for spending and
 * green for income or savings, down the other way round, grey when it rounds to nothing. An icon
 * says the direction; screen readers hear the sentence ("5% more than your 6-month average").
 *
 * Motion: its colour moves to the new meaning in 150 ms when the value changes; cut under reduced
 * motion.
 */
export function Delta({
  value,
  reference,
  referenceLabel,
  meaning = "spending",
  show = "percent",
  whole = false,
  locale,
}: DeltaProps) {
  const messages = useUiMessages().money;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const comparison = compare(value, reference);
  const trend = trendOf(comparison);
  const asPercent = show === "percent" && comparison.percent !== null;
  const good = meaning === "spending" ? trend === "down" : trend === "up";

  const magnitude =
    asPercent && comparison.percent !== null
      ? formatPercent(Math.abs(comparison.percent), { locale: writtenIn })
      : formatMoney(
          { ...comparison.change, minor: Math.abs(comparison.change.minor) },
          { locale: writtenIn, whole },
        );

  const sentence =
    trend === "steady"
      ? messages.deltaSteady(referenceLabel)
      : (trend === "up" ? messages.deltaMore : messages.deltaLess)(magnitude, referenceLabel);

  return (
    <span
      data-slot="delta"
      data-trend={trend}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap tabular-nums transition-colors duration-150",
        trend === "steady" && "text-muted-foreground",
        trend !== "steady" && good && "text-money-income",
        trend !== "steady" && !good && "text-destructive",
      )}
    >
      <Icon name={trend} size="sm" />
      <span aria-hidden="true">
        <DeltaText comparison={comparison} asPercent={asPercent} whole={whole} locale={writtenIn} />
      </span>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}
