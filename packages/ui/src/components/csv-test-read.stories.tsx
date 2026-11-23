import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { CsvTestRead } from "./csv-test-read";
import type { CsvTestResult } from "./csv-test-read";

const LINES: CsvTestResult = {
  kind: "lines",
  headings: { date: "Date", label: "Label", amount: "Amount" },
  lines: [
    { line: 2, date: "21 Oct. 2026", label: "MEALCARD GREENMARKET RIVERTON", amount: "−€28.00" },
    { line: 3, date: "20 Oct. 2026", label: "MEALCARD CORNER BISTRO", amount: "−€12.50" },
    { line: 4, date: "18 Oct. 2026", label: "TOP-UP MEALCARD OCTOBER", amount: "€180.00" },
  ],
};

const REFUSED: CsvTestResult = {
  kind: "refused",
  message: "Line 4, column 1: “31/02/2026” is no date written DD/MM/YYYY (like 03/10/2026).",
};

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-4xl rounded-lg border bg-card p-6">{children}</div>;
}

/** A test read on demand: the first press reads the lines, the next one a refusal, and so on. */
function Reading() {
  const [reads, setReads] = useState(0);
  const read = reads % 2 === 1 ? LINES : REFUSED;
  const result = reads === 0 ? null : read;

  return (
    <div className="flex w-full max-w-4xl flex-col items-start gap-4">
      <InBlock>
        <CsvTestRead label="Test read" result={result} />
      </InBlock>
      <Button variant="secondary" onClick={() => setReads(reads + 1)}>
        Test the reading
      </Button>
    </div>
  );
}

/**
 * The result of a test read with the profile being made: the first lines as the import would save
 * them (date, label, amount, each written by the page), or why the file cannot be read, naming the
 * line and the column. Nothing before the first read.
 *
 * Accessibility: a labelled polite live region: screen readers hear each new result. The lines
 * are a table with its headers; amounts right-aligned in tabular figures.
 *
 * Motion: each new result fades in (200 ms, ease-out); the same result again stays as it is. Cut
 * under reduced motion, where it appears at once.
 *
 * Don't: show the whole file (a few lines say whether the profile is right), or a trace in place
 * of the message.
 */
const meta = {
  title: "Import/CSV test read",
  component: CsvTestRead,
  args: { label: "Test read", result: LINES },
  render: (args) => (
    <InBlock>
      <CsvTestRead {...args} />
    </InBlock>
  ),
} satisfies Meta<typeof CsvTestRead>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The first lines, read with the profile. */
export const Default: Story = {};

/** The file cannot be read with it: the line and the column say where. */
export const Refused: Story = { args: { result: REFUSED } };

/** Before the first read: nothing. */
export const NotYet: Story = { args: { result: null } };

/** Each read's result fades in. */
export const Fading: Story = { render: () => <Reading /> };

/** On a French page: the page writes the lines and the words in French. */
export const French: Story = {
  args: {
    label: "Lecture d'essai",
    result: {
      kind: "lines",
      headings: { date: "Date", label: "Libellé", amount: "Montant" },
      lines: [
        {
          line: 2,
          date: "21 oct. 2026",
          label: "MEALCARD GREENMARKET RIVERTON",
          amount: "−28,00 €",
        },
        { line: 3, date: "20 oct. 2026", label: "MEALCARD CORNER BISTRO", amount: "−12,50 €" },
      ],
    },
  },
  render: (args) => (
    <InFrench>
      <InBlock>
        <CsvTestRead {...args} />
      </InBlock>
    </InFrench>
  ),
};

/** On a phone a long label is cut, the amount kept whole. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
