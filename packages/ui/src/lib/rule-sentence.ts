import type { UiMessages } from "./messages";
import type { RuleCondition, RuleConditions } from "./rule-fields";

// A rule's conditions as one sentence (docs/wireframes, screen 9: rules as "if… then…"): `label
// contains “GREENMARKET” and day between 3 and 7`. The words come from the ui's messages, the
// accounts' and merchants' names from the page.

type RuleMessages = UiMessages["rules"];

/** An account a condition may name, as the page calls it. */
export type RuleAccountName = { readonly id: string; readonly name: string };

/** A merchant a condition may name, by its name. */
export type RuleMerchantName = { readonly id: string; readonly name: string };

/** What conditions name, as the page calls them: accounts, and merchants. */
export type RuleNames = {
  readonly accounts: ReadonlyArray<RuleAccountName>;
  readonly merchants: ReadonlyArray<RuleMerchantName>;
};

/** One formatter per language, built once: building one is slow. */
const numbers = new Map<string, Intl.NumberFormat>();
const days = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string): Intl.NumberFormat {
  const known = numbers.get(locale);

  if (known !== undefined) {
    return known;
  }

  // An amount is in its account's units (12.5 for €12.50): its decimals as written, no currency.
  const made = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });

  numbers.set(locale, made);

  return made;
}

function dayFormat(locale: string): Intl.DateTimeFormat {
  const known = days.get(locale);

  if (known !== undefined) {
    return known;
  }

  const made = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  days.set(locale, made);

  return made;
}

/** A day (`YYYY-MM-DD`) as the page's language writes it: "12 Oct 2026". */
export function ruleDay(day: string, locale: string): string {
  return dayFormat(locale).format(new Date(`${day}T00:00:00Z`));
}

/** One condition, worded: `label contains “GREENMARKET”`, `money goes out`. */
export function conditionSentence(
  messages: RuleMessages,
  condition: RuleCondition,
  names: RuleNames,
  locale: string,
): string {
  const number = (value: number) => numberFormat(locale).format(value);
  const { says, operators } = messages;

  switch (condition.field) {
    case "label": {
      return messages.sentence(
        says.label,
        operators[condition.operator],
        messages.quoted(condition.value),
      );
    }

    case "merchant": {
      const merchant = names.merchants.find((each) => each.id === condition.value);

      // A merchant deleted since: its condition matches no line, and has no name to give.
      return messages.sentence(says.merchant, operators[condition.operator], merchant?.name ?? "—");
    }

    case "account": {
      const account = names.accounts.find((each) => each.id === condition.value);

      // An account deleted since: its condition matches no line, and has no name to give.
      return messages.sentence(says.account, operators[condition.operator], account?.name ?? "—");
    }

    case "amount": {
      return condition.operator === "between"
        ? messages.sentenceBetween(
            says.amount,
            number(condition.value[0]),
            number(condition.value[1]),
          )
        : messages.sentence(says.amount, operators[condition.operator], number(condition.value));
    }

    case "direction": {
      return condition.value === "out" ? says.out : says.in;
    }

    case "day": {
      return condition.operator === "between"
        ? messages.sentenceBetween(says.day, number(condition.value[0]), number(condition.value[1]))
        : messages.sentence(says.day, operators[condition.operator], number(condition.value));
    }

    case "date": {
      return condition.operator === "between"
        ? messages.sentenceBetween(
            says.date,
            ruleDay(condition.value[0], locale),
            ruleDay(condition.value[1], locale),
          )
        : messages.sentence(
            says.date,
            dateOperator(messages, condition.operator),
            ruleDay(condition.value, locale),
          );
    }
  }
}

/** A date's operator, as a date is said: "on", "on or after", "on or before". */
export function dateOperator(messages: RuleMessages, operator: "eq" | "gte" | "lte"): string {
  switch (operator) {
    case "eq":
      return messages.operators.on;
    case "gte":
      return messages.operators.from;
    case "lte":
      return messages.operators.until;
  }
}

/** Every condition of a rule, worded and joined by "and": all of them are to be met. */
export function conditionsSentence(
  messages: RuleMessages,
  conditions: RuleConditions,
  names: RuleNames,
  locale: string,
): string {
  return conditions.children
    .map((each) => conditionSentence(messages, each, names, locale))
    .join(` ${messages.and} `);
}
