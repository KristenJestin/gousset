import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { OPERATION_FIELDS } from "../lib/csv-fields";
import type { CsvField } from "../lib/csv-fields";
import { CsvMapping } from "./csv-mapping";
import type { CsvMappingProps } from "./csv-mapping";

const FIELDS: CsvMappingProps["fields"] = {
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

const COLUMNS = ["Date", "Libellé", "Type", "Montant"];

const ROWS = [
  ["21/10/2026", "MEALCARD GREENMARKET RIVERTON", "CB", "-28,00"],
  ["20/10/2026", "MEALCARD CORNER BISTRO", "CB", "-12,50"],
  ["18/10/2026", "TOP-UP MEALCARD OCTOBER", "VIR", "180,00"],
  ["15/10/2026", "MEALCARD BAKERY OF THE MILL", "CB", "-6,40"],
];

const MAPPED: ReadonlyArray<CsvField> = ["bookedOn", "label", "ignored", "amount"];

const UNMAPPED: ReadonlyArray<CsvField> = ["ignored", "ignored", "ignored", "ignored"];

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-4xl rounded-lg border bg-card p-6">{children}</div>;
}

/** The mapping kept by the story, as a page keeps it: each choice lights its column up. */
function Mapping(props: CsvMappingProps) {
  const [mapping, setMapping] = useState(props.mapping);

  return (
    <InBlock>
      <CsvMapping
        {...props}
        mapping={mapping}
        onMappingChange={(column, field) =>
          setMapping(mapping.map((held, index) => (index === column - 1 ? field : held)))
        }
      />
    </InBlock>
  );
}

/**
 * The first lines of a CSV file the app could not read on its own (wireframe, screen 6, block 3):
 * above each column a list says what it holds (booking date, value date, label, memo, signed
 * amount, debit, credit, bank id, currency) or "Ignored". The values are shown as the file writes
 * them; a wide file scrolls sideways. The page gives every word, the columns' names (the file's
 * header, or "Column 3") and keeps the mapping.
 *
 * Accessibility: a labelled table; each column's list is named after the column ("What Libellé
 * holds") and opens from the keyboard like any `Select`.
 *
 * Motion: a mapped column lights up (its cells take the primary tint, its values the full text
 * colour, 200 ms, ease-out) and goes back when ignored again; cut under reduced motion.
 *
 * Don't: show more than a few lines (the test read shows the result), turn the values into dates
 * or amounts here (they are the file's own text), or restyle it in a page.
 */
const meta = {
  title: "Import/CSV mapping",
  component: CsvMapping,
  args: {
    label: "The first lines of export.csv",
    columns: COLUMNS,
    rows: ROWS,
    fields: FIELDS,
    mapping: MAPPED,
    onMappingChange: () => undefined,
    chooseLabel: (column) => `What ${column} holds`,
  },
  render: (args) => <Mapping {...args} />,
} satisfies Meta<typeof CsvMapping>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Each column mapped but the card's type, ignored. */
export const Default: Story = {};

/** Nothing mapped yet: every column is ignored, none lit. Choose one to see it light up. */
export const Unmapped: Story = { args: { mapping: UNMAPPED } };

/** Money out and money in in two columns: one for debits, one for credits. */
export const DebitAndCredit: Story = {
  args: {
    columns: ["Date opération", "Date valeur", "Libellé", "Débit", "Crédit", "Référence"],
    rows: [
      ["03/10/2026", "04/10/2026", "CB WAVELY MOBILE", "16,00", "", "A7731"],
      ["02/10/2026", "02/10/2026", "VIR SALARY ACME WORKS", "", "2 900,00", "A7730"],
      ["01/10/2026", "02/10/2026", "PRLV HOME INSURANCE", "42,10", "", "A7729"],
    ],
    mapping: ["bookedOn", "valueOn", "label", "debit", "credit", "bankId"],
  },
};

/** A file without a header: the page names the columns by their number. */
export const NoHeader: Story = {
  args: {
    columns: ["Column 1", "Column 2", "Column 3", "Column 4"],
    mapping: ["bookedOn", "label", "ignored", "ignored"],
  },
};

/** A wide file, more columns than the block: it scrolls sideways. */
export const Wide: Story = {
  args: {
    columns: [...COLUMNS, "Catégorie", "Devise", "Pays", "Commerçant", "Carte"],
    rows: ROWS.map((row) => [...row, "Food", "EUR", "FR", "GREENMARKET", "****0042"]),
    mapping: [...MAPPED, "ignored", "currency", "ignored", "memo", "ignored"],
  },
};

/**
 * A broker's export of operations (v0.6): the lists offer an operation's fields, its kind, its
 * security, its quantity and price, its fees and the cash it moved.
 */
export const Operations: Story = {
  args: {
    columns: ["Day", "What", "ISIN", "Name", "Units", "Price", "Fees", "Cash"],
    rows: [
      ["2026-10-01", "Cash in", "", "", "", "", "", "500,00"],
      [
        "2026-10-02",
        "Buy",
        "XX0000000028",
        "NORTHWIND 2030 BOND",
        "10",
        "0,9876",
        "1,00",
        "-10,88",
      ],
      ["2026-10-20", "Coupon", "XX0000000028", "NORTHWIND 2030 BOND", "", "", "", "12,00"],
    ],
    fields: {
      ...FIELDS,
      amount: "Amount",
      kind: "Kind of operation",
      isin: "ISIN",
      securityName: "Security's name",
      securityCurrency: "Security's currency",
      quantity: "Quantity",
      unitPrice: "Unit price",
      fees: "Fees",
      reference: "Broker's reference",
    },
    offered: OPERATION_FIELDS,
    mapping: [
      "bookedOn",
      "kind",
      "isin",
      "securityName",
      "quantity",
      "unitPrice",
      "fees",
      "amount",
    ],
  },
};

/** On a French page: the page gives the fields' names in French. */
export const French: Story = {
  args: {
    label: "Les premières lignes de export.csv",
    fields: {
      bookedOn: "Date d'opération",
      valueOn: "Date de valeur",
      label: "Libellé",
      memo: "Note",
      amount: "Montant (signé)",
      debit: "Débit",
      credit: "Crédit",
      bankId: "Identifiant de la banque",
      currency: "Devise",
      ignored: "Ignorée",
    },
    chooseLabel: (column) => `Ce que contient ${column}`,
  },
  render: (args) => (
    <InFrench>
      <Mapping {...args} />
    </InFrench>
  ),
};

/** On a phone the table scrolls sideways under the block's width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
