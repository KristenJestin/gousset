import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { CsvSettings } from "./csv-settings";
import type { CsvSettingsProps, CsvSettingsValue } from "./csv-settings";

const LABELS: CsvSettingsProps["labels"] = {
  separator: "Separator",
  encoding: "Encoding",
  skipRows: "Lines to skip",
  headerRow: "The first line names the columns",
  dateFormat: "Date format",
  decimalMark: "Decimal mark",
};

const CHOICES: CsvSettingsProps["choices"] = {
  separator: [
    { value: ";", label: "Semicolon ;" },
    { value: ",", label: "Comma ," },
    { value: "\t", label: "Tab" },
    { value: "|", label: "Bar |" },
  ],
  encoding: [
    { value: "utf8", label: "Unicode (UTF-8)" },
    { value: "windows-1252", label: "Windows-1252 (Latin-1)" },
  ],
  dateFormat: [
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY (03/10/2026)" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY (10/03/2026)" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-10-03)" },
    { value: "DD.MM.YYYY", label: "DD.MM.YYYY (03.10.2026)" },
  ],
  decimalMark: [
    { value: ",", label: "Comma (12,50)" },
    { value: ".", label: "Point (12.50)" },
  ],
};

const VALUE: CsvSettingsValue = {
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
};

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-4xl rounded-lg border bg-card p-6">{children}</div>;
}

/** The settings kept by the story, as a page keeps them; what it was handed shows under it. */
function Settings(props: CsvSettingsProps) {
  const [value, setValue] = useState(props.value);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <InBlock>
        <CsvSettings {...props} value={value} onChange={setValue} />
      </InBlock>
      <output data-testid="settings" className="text-sm text-muted-foreground">
        {JSON.stringify(value)}
      </output>
    </div>
  );
}

/**
 * The settings of a CSV file its columns do not say, beside its preview: the separator, the
 * encoding, the lines to skip before the header, whether the first line names the columns, the
 * date format and the decimal mark. The page gives every word and every choice, and keeps the
 * value; each change hands it the whole settings.
 *
 * Accessibility: each control is labelled; the lists open from the keyboard, the box ticks with
 * Space.
 *
 * Motion: none of its own; its lists fade in (150 ms) and its box ticks as `Select` and `Checkbox`
 * do, cut under reduced motion.
 *
 * Don't: offer a choice the import profile cannot read, or ask here what a column holds (that is
 * `CsvMapping`).
 */
const meta = {
  title: "Import/CSV settings",
  component: CsvSettings,
  args: { labels: LABELS, choices: CHOICES, value: VALUE, onChange: () => undefined },
  render: (args) => <Settings {...args} />,
} satisfies Meta<typeof CsvSettings>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A French bank's export: semicolons, day first, a decimal comma. */
export const Default: Story = {};

/** A file with two lines before its header (the account, the period), in Windows-1252. */
export const LinesToSkip: Story = {
  args: { value: { ...VALUE, skipRows: 2, encoding: "windows-1252" } },
};

/** While a test read or the import runs: nothing changes. */
export const Disabled: Story = { args: { disabled: true } };

/** On a French page: the page gives the words in French. */
export const French: Story = {
  args: {
    labels: {
      separator: "Séparateur",
      encoding: "Encodage",
      skipRows: "Lignes à sauter",
      headerRow: "La première ligne nomme les colonnes",
      dateFormat: "Format des dates",
      decimalMark: "Séparateur décimal",
    },
  },
  render: (args) => (
    <InFrench>
      <Settings {...args} />
    </InFrench>
  ),
};

/** On a phone the settings stack, one per line. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
