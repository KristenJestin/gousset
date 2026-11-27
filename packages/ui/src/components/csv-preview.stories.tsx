import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { CsvField } from "../lib/csv-fields";
import { Button } from "./button";
import { CsvMapping } from "./csv-mapping";
import { CsvPreview } from "./csv-preview";
import { CsvSettings } from "./csv-settings";
import type { CsvSettingsValue } from "./csv-settings";
import { CsvTestRead } from "./csv-test-read";
import { FileButton } from "./file-button";
import { Select } from "./select";
import { Sheet } from "./sheet";
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

/** The preview as the import screen fills its sheet, its mapping and settings kept by the story. */
function Preview() {
  const [mapping, setMapping] = useState<ReadonlyArray<CsvField>>([
    "bookedOn",
    "label",
    "ignored",
    "amount",
  ]);

  const [settings, setSettings] = useState(SETTINGS);

  return (
    <CsvPreview
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
          columns={["Date", "Libellé", "Type", "Montant"]}
          rows={ROWS}
          fields={FIELDS}
          mapping={mapping}
          onMappingChange={(column, field) =>
            setMapping(mapping.map((held, index) => (index === column - 1 ? field : held)))
          }
          chooseLabel={(column) => `What ${column} holds`}
        />
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
    />
  );
}

/** The sheet's body alone, as wide as the sheet's on a wide screen. */
function Body() {
  return (
    <div className="w-full max-w-3xl rounded-lg border bg-popover p-6">
      <Preview />
    </div>
  );
}

/** The preview in its sheet, opened from the file's card: the sheet the import screen opens. */
function InSheet() {
  return (
    <Sheet
      trigger={<Button size="sm">Confirm the columns</Button>}
      title="The columns of mealcard.csv"
      description="Gousset could not tell everything about how this file is written. Choose a profile that reads it, or say what each column holds."
      size="xl"
      onSubmit={(event) => event.preventDefault()}
      actions={<Button type="submit">Read the file this way</Button>}
    >
      <Preview />
    </Sheet>
  );
}

/**
 * The body of the side sheet (`Sheet`, `xl`) where the import screen maps a CSV file the app could
 * not read on its own, opened from the file's card (#210): the profile it is read with (or "the
 * columns as mapped below") and a profile file to import, the first lines with each column mapped,
 * the file's settings, the test read, and saving the mapping as a named profile. The sheet says
 * what the file left open (its description) and holds the import's action, last. Layout only: the
 * page gives every part.
 *
 * Motion: none of its own; a column lights up as it is mapped (200 ms) and the test read's result
 * fades in (200 ms), both cut under reduced motion. The sheet slides in from its edge.
 *
 * Don't: put it in the page under the file's row (a page holds no form), or put the import's
 * action anywhere but the sheet's actions, last.
 */
const meta = {
  title: "Import/CSV preview",
  component: CsvPreview,
  render: () => <Body />,
} satisfies Meta<typeof CsvPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A file mapped by hand, its test read passing. */
export const Default: Story = {
  args: {
    profile: null,
    mapping: null,
    settings: null,
    testReadTitle: "Test read",
    testRead: null,
    save: null,
  },
};

/** In its sheet, opened from the file's card: Cancel, then the import's action, last. */
export const InASheet: Story = { ...Default, render: () => <InSheet /> };

/** On a phone, a bottom sheet: everything stacks; the lines scroll sideways. */
export const Phone: Story = {
  ...InASheet,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
