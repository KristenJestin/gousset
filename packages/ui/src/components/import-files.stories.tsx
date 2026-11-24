import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { ACCOUNTS } from "../stories/made-up";
import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { ButtonLink } from "./button-link";
import { ImportFiles } from "./import-files";
import type { ImportFileRow, ImportFilesColumns } from "./import-files";
import { ImportPrompt } from "./import-prompt";
import { ImportSummary } from "./import-summary";
import { JobProgress } from "./job-progress";
import { Select } from "./select";

const COLUMNS: ImportFilesColumns = {
  file: "File",
  added: "New",
  known: "Already known",
  state: "State",
};

const ACCOUNT_ITEMS = ACCOUNTS.map(({ id, name }) => ({ value: id, label: name }));

const WAITING_FILE = "mealcard-transactions-export-2026-10-31T18-42-07.csv";

const IMPORTED_FILE =
  "northbank_current-account_statement_full-history_2016-01-01_to_2026-10-31.ofx";

const FAILED_FILE = "harbor-savings-home-loan-statement-2026-09.ofx";

/** The question a file that names no account asks, as the page puts it under its row. */
function ChooseAccount({ file }: { file: string }) {
  return (
    <ImportPrompt
      message="This file does not say which account it belongs to."
      control={
        <Select
          label={`Account of ${file}`}
          hideLabel
          size="sm"
          items={ACCOUNT_ITEMS}
          placeholder="Choose the account"
        />
      }
      actions={<Button size="sm">Import into this account</Button>}
    />
  );
}

/** Why a file failed, and what to do: undo, quietly, or try again. */
function Failure() {
  return (
    <ImportPrompt
      tone="error"
      message="The file is damaged or was cut short: download it again from the bank."
      actions={
        <>
          <Button variant="quiet" size="sm" icon="undo">
            Undo this import
          </Button>
          <Button variant="secondary" size="sm" icon="retry">
            Try again
          </Button>
        </>
      }
    />
  );
}

/** An import's summary with its actions: undo set back, the way forward last. */
function Summary() {
  return (
    <ImportSummary
      label={`What ${IMPORTED_FILE} brought`}
      read={{ label: "Lines read", count: 4812 }}
      added={{ label: "Added", count: 4790 }}
      known={{ label: "Already known", count: 22 }}
      review={{ label: "To review", count: 14 }}
      actions={
        <>
          <Button variant="quiet" size="sm" icon="undo">
            Undo this import
          </Button>
          <ButtonLink href="#" size="sm" trailingIcon="next">
            Continue to the review
          </ButtonLink>
        </>
      }
    />
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
      done={1840}
      total={2310}
      attempt={1}
      attempts={3}
    />
  );
}

const WAITING: ImportFileRow = {
  id: "mealcard",
  file: WAITING_FILE,
  format: "CSV · profile “MealCard”",
  account: null,
  period: "1–31 Oct. 2026",
  added: null,
  known: null,
  state: "Account to choose",
  tone: "action",
  content: <ChooseAccount file={WAITING_FILE} />,
};

const RUNNING: ImportFileRow = {
  id: "livret",
  file: "northbank-livret-a-savings_2016-01-01_2026-10-31.qif",
  format: "QIF",
  account: "Livret A",
  period: "1 Jan. 2016 – 31 Oct. 2026",
  added: null,
  known: null,
  state: "Reading",
  tone: "busy",
  content: <ImportJob file="northbank-livret-a-savings_2016-01-01_2026-10-31.qif" />,
};

const FAILED: ImportFileRow = {
  id: "loan",
  file: FAILED_FILE,
  format: "OFX",
  account: "Home loan",
  period: null,
  added: null,
  known: null,
  state: "Failed",
  tone: "error",
  content: <Failure />,
};

const IMPORTED: ImportFileRow = {
  id: "current",
  file: IMPORTED_FILE,
  format: "OFX",
  account: "Current account",
  period: "1 Jan. 2016 – 31 Oct. 2026",
  added: 4790,
  known: 22,
  state: "Imported",
  tone: "done",
  content: <Summary />,
};

const OLDER: ImportFileRow = {
  id: "pea",
  file: "northbank-pea-operations-2025-annual.csv",
  format: "CSV · profile “Northbank PEA”",
  account: "PEA",
  period: "2 Jan. – 31 Dec. 2025",
  added: 48,
  known: 0,
  state: "Imported",
  tone: "done",
};

const UNDONE: ImportFileRow = {
  id: "october",
  file: "statement_october (1).ofx",
  format: "OFX",
  account: "Current account",
  period: "1–31 Oct. 2026",
  added: null,
  known: null,
  state: "Undone",
  tone: "undone",
};

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-5xl rounded-lg border bg-card p-4 md:p-6">{children}</div>;
}

/** Each press shows or hides the first row's job under it, the only content: it unfolds. */
function OpeningARow() {
  const [open, setOpen] = useState(false);

  const rows = [OLDER, UNDONE].map((row): ImportFileRow =>
    row.id === "pea"
      ? {
          ...row,
          state: open ? "Reading" : "Imported",
          tone: open ? "busy" : "done",
          content: open ? <ImportJob file={row.file} /> : undefined,
        }
      : row,
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
 * The files of an import, one row each (wireframe, screen 6, block 2): the file's name first, its
 * facts set back under it (format, account, period); the lines new to the app and those it
 * already knows, right-aligned in fixed widths so that they line up; where it stands, as a
 * `StatusChip`. A long name keeps its end (dates, extension) and gives way at its start; the
 * whole name is its tooltip. Under a row, what the page puts there: the file's `JobProgress`, a
 * question to answer (`ImportPrompt`), its summary (`ImportSummary`). A count not made yet is a
 * dash (screen readers hear "Not known yet").
 *
 * The page gives every word: the column headers, the states, the formats, the account's name.
 *
 * A table on a wide screen; on a phone each file is a stack: its name on two lines at most, its
 * facts, then its state and its counts.
 *
 * Motion: a row's content unfolds when it appears (revealed from its top and faded in, 250 ms, ease-out); under
 * reduced motion it simply appears.
 *
 * Don't: put it in a block inside the import's block, write a count as text ("58 lines"), colour
 * a state that asks nothing of the user, or put a whole form under every row at once: one
 * question at a time.
 */
const meta = {
  title: "Import/Import files",
  component: ImportFiles,
  args: {
    label: "Files to import",
    columns: COLUMNS,
    rows: [WAITING, RUNNING, FAILED, IMPORTED, OLDER, UNDONE],
  },
  render: (args) => (
    <InBlock>
      <ImportFiles {...args} />
    </InBlock>
  ),
} satisfies Meta<typeof ImportFiles>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Six files in every state: an account to choose, reading, failed, imported, undone. */
export const Checking: Story = {};

/** A file that names no account: the question on one inset line under it. */
export const WaitingForAccount: Story = { args: { rows: [WAITING, OLDER] } };

/** The newest import done: its summary under it, undo set back, the way forward last. */
export const Imported: Story = { args: { rows: [IMPORTED, OLDER] } };

/** A failed file: its red chip, why it failed, and what to do under it. */
export const Failed: Story = { args: { rows: [FAILED, OLDER] } };

/** Just dropped: nothing known yet but the names. */
export const JustDropped: Story = {
  args: {
    rows: [WAITING, RUNNING, FAILED].map(({ id, file }) => ({
      id,
      file,
      format: null,
      account: null,
      period: null,
      added: null,
      known: null,
      state: "Uploading",
      tone: "busy",
    })),
  },
};

/** A row's job appears under it at the press of the button: it unfolds. */
export const OpeningRow: Story = { render: () => <OpeningARow /> };

/** Large counts in tabular figures, right-aligned in their column. */
export const LargeCounts: Story = {
  args: {
    rows: [
      { ...OLDER, id: "year", added: 1204, known: 13_870 },
      { ...OLDER, id: "small", file: "savings.qif", added: 2, known: 0 },
    ],
  },
};

/** On a French page: the counts in French; the page gives the rest. */
export const French: Story = {
  args: {
    label: "Fichiers à importer",
    columns: { file: "Fichier", added: "Nouvelles", known: "Déjà connues", state: "État" },
    rows: [
      {
        id: "year",
        file: "releve_compte-courant_2025-01-01_au_2025-12-31.ofx",
        format: "OFX",
        account: "Compte courant",
        period: "du 1 janv. 2025 au 31 déc. 2025",
        added: 1204,
        known: 13_870,
        state: "Importé",
        tone: "done",
      },
      {
        id: "unknown",
        file: "export.csv",
        format: "CSV",
        account: null,
        period: null,
        added: null,
        known: null,
        state: "Colonnes à confirmer",
        tone: "action",
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

/** On a phone each file is a stack: name, facts, then its state and its counts. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
