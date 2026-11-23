import { minorDigits } from "@gousset/currency";
import type { RuleNode } from "@qnot/core";
import { QueryProvider, useGroup, useQueryStore, useRule, useStore } from "@qnot/react";
import { useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import type { UiMessages } from "../lib/messages";
import { RULE_FIELDS, RULE_OPERATORS, ruleFields } from "../lib/rule-fields";
import type {
  RuleConditions,
  RuleConditionsDraft,
  RuleField,
  RuleFields,
  RuleOperator,
} from "../lib/rule-fields";
import { dateOperator } from "../lib/rule-sentence";
import type { RuleAccountName } from "../lib/rule-sentence";
import { Button } from "./button";
import { DatePicker } from "./date-picker";
import { IconButton } from "./icon-button";
import { MoneyField } from "./money-field";
import { Select } from "./select";
import { TextField } from "./text-field";

// A rule's conditions (#25), edited on qnot's headless hooks (`@qnot/react`): its store holds the
// query in qnot's own shape, on the fields `lib/rule-fields.ts` declares; every row, field and
// value is drawn here with packages/ui's controls, never with qnot's default builder or its
// stylesheet. One flat group, every condition to be met. The page reads what the editor gives
// with the server's own checks.

export type RuleConditionError = {
  /** The condition it is about, from 0. */
  index: number;
  message: string;
};

export type RuleConditionsEditorProps = {
  /** The rule's conditions at first, none for a new rule; a page that starts again changes `key`. */
  initial: RuleConditions | null;
  /** Each change, as qnot holds it: values may still be missing while the user types. */
  onChange: (draft: RuleConditionsDraft) => void;
  /** The accounts a condition may name, as the page calls them. */
  accounts: ReadonlyArray<RuleAccountName>;
  /** The user's currency: how many decimals an amount is typed with. */
  currency: string;
  /** The most conditions a rule may have, and the longest piece of label: the server's limits. */
  maxConditions: number;
  maxLabelText: number;
  /** The server's refusal of one condition, shown under it. */
  error?: RuleConditionError;
  disabled?: boolean;
};

/** A new rule starts with one condition on its label, the one most rules have. */
const FIRST_CONDITION: RuleConditionsDraft = {
  kind: "group",
  combinator: "and",
  children: [{ kind: "rule", field: "label", operator: "contains", value: "" }],
};

type Slot = string | number | null;

/** A condition's value as its controls read it: one, or the two of "between". */
type Slots = { one: Slot; pair: readonly [Slot, Slot] };

const NONE: Slots = { one: null, pair: [null, null] };

/** What qnot lets the user do: a flat list of conditions, up to the limit, on values alone. */
function settingsOf(readOnly: boolean, maxRules: number) {
  return { readOnly, maxRules, maxDepth: 0, allowRefs: false, allowFunctions: false };
}

function slotsOf(node: RuleNode<RuleFields>): Slots {
  switch (node.field) {
    case "amount":
    case "day":
    case "date":
      return node.operator === "between"
        ? { one: null, pair: node.value ?? [null, null] }
        : { one: node.value ?? null, pair: [null, null] };
    case "label":
    case "account":
    case "direction":
      return { one: node.value ?? null, pair: [null, null] };
    default:
      return NONE;
  }
}

const textOf = (slot: Slot) => (slot === null ? null : `${slot}`);

const numberOf = (slot: Slot) => {
  const read = slot === null || slot === "" ? Number.NaN : Number(slot);

  return Number.isFinite(read) ? read : null;
};

/** The field a qnot rule names, among the rules'; the label for anything else. */
function fieldOf(name: string | { readonly fn: string }): RuleField {
  return RULE_FIELDS.find((each) => each === name) ?? "label";
}

/** An operator as the editor offers it: a date's are "on", "on or after", "on or before". */
function operatorLabel(
  messages: UiMessages["rules"],
  field: RuleField,
  operator: RuleOperator,
): string {
  if (field === "date") {
    switch (operator) {
      case "eq":
      case "gte":
      case "lte":
        return dateOperator(messages, operator);
      default:
        return messages.operators[operator];
    }
  }

  return messages.operators[operator];
}

/**
 * The conditions of a rule, one row each: its field, its operator and its value, typed with the
 * control its field takes (a text, an account, an amount or two for "between", money out or in, a
 * day of the month, a date or two). "+ Condition" adds one, up to `maxConditions`; each row's ✕
 * removes it.
 *
 * Motion: a condition added fades and slides down into its place in 150 ms, ease-out; its selects'
 * lists fade in 150 ms (`Select`). Cut under reduced motion.
 */
export function RuleConditionsEditor({
  initial,
  onChange,
  accounts,
  currency,
  maxConditions,
  maxLabelText,
  error,
  disabled = false,
}: RuleConditionsEditorProps) {
  // qnot applies `settings` again whenever it is another object, and tells every listener, so
  // `onChange` too: a new object at each render made each change render again, without end. They
  // are kept, and replaced only when what they say changes.
  const [settings, setSettings] = useState(() => settingsOf(disabled, maxConditions));

  if (settings.readOnly !== disabled || settings.maxRules !== maxConditions) {
    setSettings(settingsOf(disabled, maxConditions));
  }

  const store = useQueryStore({
    fields: ruleFields(accounts.map((each) => each.id)),
    initial: initial ?? FIRST_CONDITION,
    onChange,
    history: false,
    settings,
  });

  return (
    <QueryProvider store={store}>
      <ConditionList
        accounts={accounts}
        currency={currency}
        maxConditions={maxConditions}
        maxLabelText={maxLabelText}
        error={error}
        disabled={disabled}
      />
    </QueryProvider>
  );
}

type RowOptions = {
  accounts: ReadonlyArray<RuleAccountName>;
  currency: string;
  maxLabelText: number;
  disabled: boolean;
};

function ConditionList({
  maxConditions,
  error,
  ...options
}: RowOptions & { maxConditions: number; error: RuleConditionError | undefined }) {
  const messages = useUiMessages().rules;
  const store = useStore<RuleFields>();
  const root = useGroup<RuleFields>(store.rootId);
  const children = root.group.children;
  const full = children.length >= maxConditions;

  return (
    <div data-slot="rule-conditions" className="flex flex-col gap-3">
      {children.length === 0 ? (
        <p className="text-sm text-muted-foreground">{messages.noCondition}</p>
      ) : (
        <ul aria-label={messages.conditions} className="flex flex-col gap-3">
          {children.map((id, index) => (
            <ConditionRow
              key={id}
              id={id}
              place={index + 1}
              error={error?.index === index ? error.message : undefined}
              {...options}
            />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon="add"
          aria-label={messages.addConditionLabel}
          disabled={options.disabled || full || !root.can.addRule}
          onClick={() => {
            root.addRule({ kind: "rule", field: "label", operator: "contains", value: "" });
          }}
        >
          {messages.addCondition}
        </Button>
        {full ? (
          <span className="text-xs text-muted-foreground">
            {messages.maxConditions(maxConditions)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ConditionRow({
  id,
  place,
  error,
  ...options
}: RowOptions & {
  id: string;
  /** Its place among the conditions, from 1: how its controls are named. */
  place: number;
  error: string | undefined;
}) {
  const messages = useUiMessages().rules;
  const rule = useRule<RuleFields>(id);
  const field = fieldOf(rule.rule.field);
  const operators: ReadonlyArray<RuleOperator> = RULE_OPERATORS[field];
  const operator = operators.find((each) => each === rule.rule.operator) ?? operators[0] ?? "eq";
  const between = operator === "between";

  return (
    <li
      data-slot="rule-condition"
      className="flex flex-col gap-2 duration-150 ease-out animate-in fade-in slide-in-from-top-1"
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label={messages.fieldOf(place)}
            hideLabel
            size="sm"
            disabled={options.disabled}
            items={RULE_FIELDS.map((each) => ({ value: each, label: messages.fields[each] }))}
            value={field}
            onValueChange={(next) => {
              const chosen = RULE_FIELDS.find((each) => each === next);

              if (chosen !== undefined && chosen !== field) {
                rule.setField(chosen);
              }
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Select
            label={messages.operatorOf(place)}
            hideLabel
            size="sm"
            disabled={options.disabled}
            items={operators.map((each) => ({
              value: each,
              label: operatorLabel(messages, field, each),
            }))}
            value={operator}
            onValueChange={(next) => {
              if (next !== null && next !== operator) {
                rule.setOperator(next);
              }
            }}
          />
        </div>
        <IconButton
          icon="close"
          size="sm"
          label={messages.removeCondition(place)}
          disabled={options.disabled || !rule.can.remove}
          onClick={() => {
            rule.remove();
          }}
        />
      </div>
      {/* A new field or a change between one value and two starts the value's controls afresh. */}
      <ConditionValue
        key={`${field}-${between ? "pair" : "one"}`}
        id={id}
        field={field}
        between={between}
        place={place}
        {...options}
      />
      {error === undefined ? null : (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/** One value, or the two of "between", typed with the control its field takes. */
function ConditionValue({
  id,
  field,
  between,
  place,
  accounts,
  currency,
  maxLabelText,
  disabled,
}: RowOptions & { id: string; field: RuleField; between: boolean; place: number }) {
  const messages = useUiMessages().rules;
  const rule = useRule<RuleFields>(id);
  const slots = slotsOf(rule.rule);

  /** The control of one value: the only one, or a side of "between". */
  const control = (slot: 0 | 1 | null, label: string) => {
    const current = slot === null ? slots.one : slots.pair[slot];

    const set = (next: Slot) => {
      if (slot === null) {
        rule.setValue(next);
      } else {
        rule.setValue(slot === 0 ? [next, slots.pair[1]] : [slots.pair[0], next]);
      }
    };

    switch (field) {
      case "label":
        return (
          <TextField
            label={label}
            hideLabel
            size="sm"
            disabled={disabled}
            maxLength={maxLabelText}
            autoComplete="off"
            value={textOf(current) ?? ""}
            onChange={(event) => set(event.target.value)}
          />
        );
      case "account":
        return (
          <Select
            label={label}
            hideLabel
            size="sm"
            disabled={disabled}
            placeholder={messages.chooseAccount}
            items={accounts.map((account) => ({ value: account.id, label: account.name }))}
            value={textOf(current)}
            onValueChange={set}
          />
        );
      case "amount":
        return (
          <AmountValue
            label={label}
            currency={currency}
            units={numberOf(current)}
            disabled={disabled}
            onUnitsChange={set}
          />
        );
      case "direction":
        return (
          <Select
            label={label}
            hideLabel
            size="sm"
            disabled={disabled}
            items={[
              { value: "out", label: messages.directionOut },
              { value: "in", label: messages.directionIn },
            ]}
            value={textOf(current)}
            onValueChange={set}
          />
        );
      case "day":
        return (
          <DayValue label={label} day={numberOf(current)} disabled={disabled} onDayChange={set} />
        );
      case "date":
        return (
          <DatePicker
            label={label}
            hideLabel
            size="sm"
            disabled={disabled}
            value={textOf(current)}
            onValueChange={set}
          />
        );
    }
  };

  if (!between) {
    return <div className="flex flex-col">{control(null, messages.valueOf(place))}</div>;
  }

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">{control(0, messages.fromOf(place))}</div>
      <div className="min-w-0 flex-1">{control(1, messages.toOf(place))}</div>
    </div>
  );
}

/**
 * An amount, typed in the user's currency's decimals and kept in units, as conditions read amounts
 * (12.5 for €12.50), without its sign: whether money leaves is the direction's condition.
 */
function AmountValue({
  label,
  currency,
  units,
  disabled,
  onUnitsChange,
}: {
  label: string;
  currency: string;
  units: number | null;
  disabled: boolean;
  onUnitsChange: (units: number | null) => void;
}) {
  const scale = 10 ** minorDigits(currency);

  return (
    <MoneyField
      label={label}
      hideLabel
      size="sm"
      disabled={disabled}
      currency={currency}
      defaultValue={units === null ? null : Math.round(units * scale)}
      onValueChange={(minor) => onUnitsChange(minor === null ? null : Math.abs(minor) / scale)}
    />
  );
}

/** A day of the month, 1 to 31; what is not one is no value yet. */
function DayValue({
  label,
  day,
  disabled,
  onDayChange,
}: {
  label: string;
  day: number | null;
  disabled: boolean;
  onDayChange: (day: number | null) => void;
}) {
  const [text, setText] = useState(day === null ? "" : `${day}`);

  return (
    <TextField
      label={label}
      hideLabel
      size="sm"
      disabled={disabled}
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const typed = event.target.value.trim();
        const read = /^\d{1,2}$/.test(typed) ? Number(typed) : null;

        setText(event.target.value);
        onDayChange(read !== null && read >= 1 && read <= 31 ? read : null);
      }}
    />
  );
}
