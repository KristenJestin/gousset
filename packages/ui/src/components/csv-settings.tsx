import { Checkbox } from "./checkbox";
import { Select } from "./select";
import type { ChoiceItem } from "./select";
import { TextField } from "./text-field";

/** A CSV file's settings, as an import profile keeps them. */
export type CsvSettingsValue = {
  /** One of `choices.separator`'s values (";", ",", a tab, "|"). */
  separator: string;
  /** One of `choices.encoding`'s values. */
  encoding: string;
  /** The file's first lines, read past before the header. */
  skipRows: number;
  /** Whether the first row after them names the columns. */
  headerRow: boolean;
  /** One of `choices.dateFormat`'s values ("DD/MM/YYYY"). */
  dateFormat: string;
  /** One of `choices.decimalMark`'s values ("," or "."). */
  decimalMark: string;
};

export type CsvSettingsProps = {
  /** Each setting's label, in the page's words. */
  labels: { [Setting in keyof CsvSettingsValue]: string };
  /** The choices of each setting picked from a list, labelled in the page's words. */
  choices: {
    separator: ReadonlyArray<ChoiceItem>;
    encoding: ReadonlyArray<ChoiceItem>;
    dateFormat: ReadonlyArray<ChoiceItem>;
    decimalMark: ReadonlyArray<ChoiceItem>;
  };
  value: CsvSettingsValue;
  /** Every change, the whole settings with it. */
  onChange: (value: CsvSettingsValue) => void;
  disabled?: boolean;
};

/**
 * The settings of a CSV file that its columns do not say, beside its preview (`CsvMapping`): the
 * separator, the encoding, the lines to skip before the header, whether there is a header row, the
 * date format and the decimal mark. Every word and every choice is the page's. It draws no block:
 * the page puts it in one.
 *
 * Motion: none of its own; its controls keep theirs (a list fades in, a box ticks).
 */
export function CsvSettings({ labels, choices, value, onChange, disabled }: CsvSettingsProps) {
  const pick = (key: "separator" | "encoding" | "dateFormat" | "decimalMark") => ({
    label: labels[key],
    items: choices[key],
    value: value[key],
    disabled,
    onValueChange: (next: string | null) => {
      if (next !== null) {
        onChange({ ...value, [key]: next });
      }
    },
  });

  return (
    <div
      data-slot="csv-settings"
      className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <Select size="sm" {...pick("separator")} />
      <Select size="sm" {...pick("encoding")} />
      <Select size="sm" {...pick("dateFormat")} />
      <Select size="sm" {...pick("decimalMark")} />
      <TextField
        label={labels.skipRows}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        size="sm"
        disabled={disabled}
        value={String(value.skipRows)}
        onChange={(event) => {
          const rows = Number(event.currentTarget.value);

          if (Number.isInteger(rows) && rows >= 0) {
            onChange({ ...value, skipRows: rows });
          }
        }}
      />
      <Checkbox
        label={labels.headerRow}
        disabled={disabled}
        checked={value.headerRow}
        onCheckedChange={(headerRow) => onChange({ ...value, headerRow })}
      />
    </div>
  );
}
