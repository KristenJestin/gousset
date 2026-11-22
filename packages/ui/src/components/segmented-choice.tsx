import { Radio, RadioGroup } from "@ui-sdk/react/radio";

export type SegmentedChoiceProps<Value extends string> = {
  /** The group's accessible name, translated ("Language"). */
  label: string;
  value: Value;
  /** Each choice, in order, with its words. */
  choices: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
};

/**
 * One choice among a few, side by side, like the colour scheme picker: a radio group the arrow
 * keys move through. Motion: the colours change in 200 ms; cut under reduced motion.
 */
export function SegmentedChoice<Value extends string>({
  label,
  value,
  choices,
  onChange,
}: SegmentedChoiceProps<Value>) {
  return (
    <RadioGroup
      aria-label={label}
      className="inline-flex w-fit gap-1 rounded-lg border bg-muted p-1"
      value={value}
      onValueChange={(next) => {
        const chosen = choices.find((choice) => choice.value === next);

        if (chosen !== undefined) {
          onChange(chosen.value);
        }
      }}
    >
      {choices.map((choice) => (
        <Radio
          key={choice.value}
          value={choice.value}
          className="rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground data-checked:bg-card data-checked:text-foreground data-checked:shadow-sm"
        >
          {choice.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}
