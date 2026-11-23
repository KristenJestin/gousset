import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { ACCOUNTS } from "../stories/made-up";
import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { ImportFiles } from "./import-files";
import type { ImportFileRow, ImportFilesColumns } from "./import-files";
import { JobProgress } from "./job-progress";
import { Select } from "./select";

const COLUMNS: ImportFilesColumns = {
  file: "File",
  format: "Format recognised",
  account: "Account",
  period: "Period",
  added: "New",
  known: "Already known",
  state: "State",
};

const ACCOUNT_ITEMS = ACCOUNTS.map(({ id, name }) => ({ value: id, label: name }));

function AccountChoice({ value }: { value: string | null }) {
  return (
    <Select
      label="Account"
      hideLabel
      size="sm"
      items={ACCOUNT_ITEMS}
      placeholder="Choose…"
      defaultValue={value}
    />
  );
}

/** The question a CSV of unknown shape asks; the real one maps its columns (issue #20). */
function MapColumns() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md bg-muted p-3">
      <p className="text-sm text-foreground">export.csv: what does each column hold?</p>
      <Button variant="secondary" size="sm">
        Map the columns
      </Button>
    </div>
  );
}

const IMPORT_STEPS = [
  { id: "read", label: "Reading the file" },
  { id: "match", label: "Finding duplicates and transfers" },
  { id: "save", label: "Saving the lines" },
];

function ImportJob({ file }: { file: string }) {
  return (
    <JobProgress
      title={`Importing ${file}`}
      steps={IMPORT_STEPS}
      phase="running"
      step="match"
      done={41}
      total={82}
      attempt={1}
      attempts={3}
    />
  );
}

/** The wireframe's four files: three ready, one CSV of unknown shape to map. */
const CHECKING: ReadonlyArray<ImportFileRow> = [
  {
    id: "october",
    file: "statement_october.ofx",
    format: "OFX",
    account: <AccountChoice value="current" />,
    period: "1–31 Oct.",
    added: 58,
    known: 24,
    state: "ready",
  },
  {
    id: "savings",
    file: "savings.qif",
    format: "QIF",
    account: <AccountChoice value="livret" />,
    period: "1–31 Oct.",
    added: 2,
    known: 0,
    state: "ready",
  },
  {
    id: "pea",
    file: "northbank_pea.csv",
    format: 'CSV · profile "Northbank PEA"',
    account: <AccountChoice value="pea" />,
    period: "1–31 Oct.",
    added: 3,
    known: 0,
    state: "ready",
  },
  {
    id: "export",
    file: "export.csv",
    format: "Unknown CSV",
    account: <AccountChoice value={null} />,
    period: null,
    added: null,
    known: null,
    state: "to map",
    attention: true,
    content: <MapColumns />,
  },
];

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-5xl rounded-lg border bg-card p-4">{children}</div>;
}

/** Each press shows or hides the first row's job under it, the only content: it unfolds. */
function OpeningARow() {
  const [open, setOpen] = useState(false);

  const rows = CHECKING.map((row) =>
    row.id === "october"
      ? {
          ...row,
          state: open ? "importing" : "ready",
          content: open ? <ImportJob file={row.file} /> : undefined,
        }
      : { ...row, content: undefined },
  );

  return (
    <div className="flex flex-col items-start gap-4">
      <InBlock>
        <ImportFiles label="Files to import" columns={COLUMNS} rows={rows} />
      </InBlock>
      <Button variant="secondary" onClick={() => setOpen(!open)}>
        {open ? "Hide the job" : "Import the first file"}
      </Button>
    </div>
  );
}

/**
 * The files of an import, one row each (wireframe, screen 6, block 2): its name, the format
 * recognised, the account its lines go to, the period it covers, the lines new to the app, those
 * it already knows, and where it stands. Under a row, what the page puts there: the file's
 * `JobProgress`, a question to answer (an unknown CSV to map), a summary. A value not known yet
 * is a dash (screen readers hear "Not known yet").
 *
 * The page gives every word: the column headers, the states, the formats; the account cell is a
 * slot, a `Select` while the file's account is to choose, or the account's name. A row with
 * `attention` (a question waits, the file failed) has its state marked.
 *
 * A table on a wide screen, counts right-aligned in tabular figures; on a phone each file is a
 * stack of lines, each naming its column.
 *
 * Motion: a row's content unfolds when it appears (revealed from its top and faded in, 250 ms, ease-out); under
 * reduced motion it simply appears.
 *
 * Don't: put it in a block inside the import's block, write a count as text ("58 lines"), or put
 * a whole form under every row at once: one question at a time.
 */
const meta = {
  title: "Import/Import files",
  component: ImportFiles,
  args: { label: "Files to import", columns: COLUMNS, rows: CHECKING },
  render: (args) => (
    <InBlock>
      <ImportFiles {...args} />
    </InBlock>
  ),
} satisfies Meta<typeof ImportFiles>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Checking the files: three ready, one CSV to map, with its question under it. */
export const Checking: Story = {};

/** Just dropped: nothing known yet but the names. */
export const JustDropped: Story = {
  args: {
    rows: CHECKING.map(({ id, file }) => ({
      id,
      file,
      format: null,
      account: null,
      period: null,
      added: null,
      known: null,
      state: "reading",
    })),
  },
};

/** Importing: each file's job under its row, the accounts named. */
export const Importing: Story = {
  args: {
    rows: [
      {
        id: "october",
        file: "statement_october.ofx",
        format: "OFX",
        account: "Current account",
        period: "1–31 Oct.",
        added: 58,
        known: 24,
        state: "importing",
        content: <ImportJob file="statement_october.ofx" />,
      },
      {
        id: "savings",
        file: "savings.qif",
        format: "QIF",
        account: "Livret A",
        period: "1–31 Oct.",
        added: 2,
        known: 0,
        state: "waiting",
      },
    ],
  },
};

/** A failed file: its state marked, what went wrong under it. */
export const Failed: Story = {
  args: {
    rows: [
      {
        id: "broken",
        file: "statement_september.ofx",
        format: "OFX",
        account: "Current account",
        period: null,
        added: null,
        known: null,
        state: "failed",
        attention: true,
        content: (
          <p className="text-sm text-foreground">
            The file ends in the middle of a line. Download it again from your bank, then drop it
            here.
          </p>
        ),
      },
    ],
  },
};

/** A row's job appears under it at the press of the button: it unfolds. */
export const OpeningRow: Story = { render: () => <OpeningARow /> };

/** Large counts in tabular figures, right-aligned in their column. */
export const LargeCounts: Story = {
  args: {
    rows: [
      {
        id: "year",
        file: "statement_2025.ofx",
        format: "OFX",
        account: "Current account",
        period: "1 Jan.–31 Dec. 2025",
        added: 1204,
        known: 13_870,
        state: "ready",
      },
      {
        id: "savings",
        file: "savings.qif",
        format: "QIF",
        account: "Livret A",
        period: "1–31 Oct.",
        added: 2,
        known: 0,
        state: "ready",
      },
    ],
  },
};

/** On a French page: the counts in French; the page gives the rest. */
export const French: Story = {
  args: {
    label: "Fichiers à importer",
    columns: {
      file: "Fichier",
      format: "Format reconnu",
      account: "Compte",
      period: "Période",
      added: "Nouvelles",
      known: "Déjà connues",
      state: "État",
    },
    rows: [
      {
        id: "year",
        file: "releve_2025.ofx",
        format: "OFX",
        account: "Compte courant",
        period: "1er janv.–31 déc. 2025",
        added: 1204,
        known: 13_870,
        state: "prêt",
      },
      {
        id: "unknown",
        file: "export.csv",
        format: "CSV inconnu",
        account: null,
        period: null,
        added: null,
        known: null,
        state: "à associer",
        attention: true,
      },
    ],
  },
  render: (args) => (
    <InFrench>
      <InBlock>
        <ImportFiles {...args} />
      </InBlock>
    </InFrench>
  ),
};

/** On a phone each file is a stack of lines, each naming its column. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
