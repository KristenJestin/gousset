import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { CsvField } from "../lib/csv-fields";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { CsvKindWords } from "./csv-kind-words";
import { CsvMapping } from "./csv-mapping";
import { CsvPreview } from "./csv-preview";
import { CsvSettings } from "./csv-settings";
import type { CsvSettingsValue } from "./csv-settings";
import { CsvTestRead } from "./csv-test-read";
import { FileButton } from "./file-button";
import { Select } from "./select";
import { StatusMessage } from "./status-message";
import { TextField } from "./text-field";

const FIELDS = {
  bookedOn: "Booking date",
  valueOn: "Value date",
  label: "Label",
  memo: "Memo",
  amount: "Amount (signed)",
  debit: "Debit",
  credit: "Credit",
  bankId: "Bank id",
  currency: "Currency",
  ignored: "Ignored",
};

const ROWS = [
  ["21/10/2026", "MEALCARD GREENMARKET RIVERTON", "CB", "-28,00"],
  ["20/10/2026", "MEALCARD CORNER BISTRO", "CB", "-12,50"],
  ["18/10/2026", "TOP-UP MEALCARD OCTOBER", "VIR", "180,00"],
];

const SETTINGS: CsvSettingsValue = {
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
};

const COLUMNS = ["Date", "Libellé", "Type", "Montant"];

const MAPPING: ReadonlyArray<CsvField> = ["bookedOn", "label", "ignored", "amount"];

/** The broker's own reference of each row, in a fifth column. */
const REFERENCES = ["R-20261021-3", "R-20261020-2", "R-20261018-1"];

/**
 * The preview as the import screen fills it, its mapping and settings kept by the story; for a
 * broker's operations, the words of its kind column under the mapping, and, with a reference column
 * (`reference`), whether each row's reference is unique.
 */
function Preview({
  operations = false,
  reference = false,
}: {
  readonly operations?: boolean;
  readonly reference?: boolean;
}) {
  const [words, setWords] = useState<ReadonlyArray<{ word: string; kind: string | null }>>([
    { word: "CB", kind: "purchase" },
    { word: "VIR", kind: null },
  ]);

  const [mapping, setMapping] = useState<ReadonlyArray<CsvField>>(
    reference ? [...MAPPING, "reference"] : MAPPING,
  );

  const [settings, setSettings] = useState(SETTINGS);
  const [unique, setUnique] = useState(true);
  const columns = reference ? [...COLUMNS, "Réf"] : COLUMNS;

  const rows = reference ? ROWS.map((row, index) => [...row, REFERENCES[index] ?? ""]) : ROWS;

  return (
    <div className="w-full max-w-4xl rounded-lg border bg-card p-6">
      <CsvPreview
        intro={
          <StatusMessage message="Gousset could not tell everything about how this file is written. Choose a profile that reads it, or say what each column holds." />
        }
        profile={
          <>
            <Select
              label="Read with"
              size="sm"
              value="hand"
              items={[
                { value: "hand", label: "The columns as mapped below" },
                { value: "shipped:fr", label: "French bank, debit and credit" },
              ]}
            />
            <FileButton size="sm" icon="import" accept=".json" onFile={() => undefined}>
              Import a profile file
            </FileButton>
          </>
        }
        mapping={
          <CsvMapping
            label="The first lines of mealcard.csv"
            columns={columns}
            rows={rows}
            fields={reference ? { ...FIELDS, reference: "Broker's reference" } : FIELDS}
            mapping={mapping}
            onMappingChange={(column, field) =>
              setMapping(mapping.map((held, index) => (index === column - 1 ? field : held)))
            }
            chooseLabel={(column) => `What ${column} holds`}
          />
        }
        kinds={
          operations
            ? {
                title: "What each word of Type says",
                words: (
                  <CsvKindWords
                    label="What each word of Type says"
                    words={words}
                    kinds={[
                      { value: "purchase", label: "Purchase" },
                      { value: "deposit", label: "Deposit" },
                    ]}
                    unmapped="Not mapped"
                    onKindChange={(word, kind) =>
                      setWords(words.map((each) => (each.word === word ? { word, kind } : each)))
                    }
                    chooseLabel={(word) => `What ${word} means`}
                  />
                ),
              }
            : undefined
        }
        options={
          reference ? (
            <Checkbox
              label="Each row's reference is unique"
              description="A row whose reference is already known is a duplicate, whatever its other values."
              checked={unique}
              onCheckedChange={setUnique}
            />
          ) : undefined
        }
        settings={
          <CsvSettings
            labels={{
              separator: "Separator",
              encoding: "Encoding",
              skipRows: "Lines to skip above the table",
              headerRow: "The first line names the columns",
              dateFormat: "Date format",
              decimalMark: "Decimal mark",
            }}
            choices={{
              separator: [
                { value: ";", label: "Semicolon (;)" },
                { value: ",", label: "Comma (,)" },
              ],
              encoding: [{ value: "utf8", label: "Unicode (UTF-8)" }],
              dateFormat: [{ value: "DD/MM/YYYY", label: "DD/MM/YYYY, as in 03/10/2026" }],
              decimalMark: [{ value: ",", label: "A comma, as in 12,34" }],
            }}
            value={settings}
            onChange={setSettings}
          />
        }
        testReadTitle="Test read"
        testRead={
          <CsvTestRead
            label="Test read"
            result={{
              kind: "lines",
              headings: { date: "Date", label: "Label", amount: "Amount" },
              lines: [
                {
                  line: 1,
                  date: "21 Oct 2026",
                  label: "MEALCARD GREENMARKET RIVERTON",
                  amount: "−€28.00",
                },
                {
                  line: 2,
                  date: "20 Oct 2026",
                  label: "MEALCARD CORNER BISTRO",
                  amount: "−€12.50",
                },
                {
                  line: 3,
                  date: "18 Oct 2026",
                  label: "TOP-UP MEALCARD OCTOBER",
                  amount: "€180.00",
                },
              ],
            }}
          />
        }
        save={
          <>
            <TextField label="Name of the profile" size="sm" defaultValue="" />
            <Button variant="secondary" size="sm">
              Save as a profile
            </Button>
          </>
        }
        actions={<Button>Read the file this way</Button>}
      />
    </div>
  );
}

/**
 * The import screen's preview of a CSV file the app could not read on its own, under its row: the
 * profile it is read with (or "the columns as mapped below") and a profile file to import, the
 * first lines with each column mapped, the file's settings, the test read, saving the mapping as a
 * named profile, and the import itself. Layout only: the page gives every part.
 *
 * Motion: none of its own; a column lights up as it is mapped (200 ms) and the test read's result
 * fades in (200 ms), both cut under reduced motion.
 *
 * Don't: open it on its own screen (it is the row's content, one flow with the import), or put the
 * import's action anywhere but last.
 */
const meta = {
  title: "Import/CSV preview",
  component: CsvPreview,
  render: () => <Preview />,
} satisfies Meta<typeof CsvPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A file mapped by hand, its test read passing. */
export const Default: Story = {
  args: {
    intro: null,
    profile: null,
    mapping: null,
    settings: null,
    testReadTitle: "Test read",
    testRead: null,
    save: null,
    actions: null,
  },
};

/** A broker's operations: the words of its kind column, each mapped to a kind, under the lines. */
export const Operations: Story = {
  ...Default,
  render: () => <Preview operations />,
};

/**
 * A broker's operations with a reference column mapped: the profile may say each row's reference is
 * unique, so that a row whose reference is known is a duplicate.
 */
export const OperationsReferenceUnique: Story = {
  ...Default,
  render: () => <Preview operations reference />,
};

/** On a phone everything stacks; the lines scroll sideways. */
export const Phone: Story = {
  ...Default,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
