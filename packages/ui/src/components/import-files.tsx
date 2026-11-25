import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { splitFileName } from "../lib/file-name";
import { cn } from "../lib/utils";
import { StatusChip } from "./status-chip";
import type { StatusTone } from "./status-chip";
import { Unfold } from "./unfold";

/** The column headers, in the page's words. */
export type ImportFilesColumns = {
  file: string;
  /** The file's facts under its name, each named for screen readers. */
  format: string;
  account: string;
  period: string;
  /** Lines the import will add. */
  added: string;
  /** Lines the app already has (duplicates). */
  known: string;
  state: string;
};

export type ImportFileRow = {
  id: string;
  /** The file's name, as dropped ("statement_october.ofx"). */
  file: string;
  /** The format recognised ("OFX", `CSV · profile "Northbank PEA"`); `null` while unknown. */
  format: string | null;
  /** The account the lines go to, by its name; `null` while unknown. */
  account: string | null;
  /** The period the file covers ("1–31 Oct."); `null` while unknown. */
  period: string | null;
  /** Lines new to the app; `null` while not counted. */
  added: number | null;
  /** Lines the app already knows; `null` while not counted. */
  known: number | null;
  /** Where the file stands, in the page's words ("Imported", "Account to choose"). */
  state: string;
  /** What the state asks of the user: its chip's colour (`StatusChip`). */
  tone?: StatusTone;
  /**
   * Shown under the row, across it: the file's `JobProgress`, a question to answer
   * (`ImportPrompt`), a summary (`ImportSummary`). It unfolds when it appears.
   */
  content?: ReactNode;
};

export type ImportFilesProps = {
  /** What the table holds, for screen readers ("Files to import"). */
  label: string;
  columns: ImportFilesColumns;
  rows: ReadonlyArray<ImportFileRow>;
  /** The page's language (`<html lang>`) unless given: it writes the counts. */
  locale?: string;
};

/** A value the import has not found yet: a dash to see, words to hear. */
function Unknown() {
  const messages = useUiMessages().imports;

  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{messages.notKnown}</span>
    </>
  );
}

function present(node: ReactNode) {
  return node !== null && node !== undefined && node !== false;
}

/**
 * The file's name. On a wide screen it holds one line, its start giving way with an ellipsis and
 * its end (dates, extension) kept whole; on a phone it takes two lines at most. The whole name is
 * its tooltip, and what screen readers hear.
 */
function FileName({ name }: { name: string }) {
  const { start, end } = splitFileName(name);

  return (
    <span
      title={name}
      data-slot="import-file-name"
      className="line-clamp-2 text-sm font-medium break-all text-foreground md:flex md:min-w-0 md:break-normal"
    >
      <span className="md:truncate">{start}</span>
      <span className="md:shrink-0 md:whitespace-nowrap">{end}</span>
    </span>
  );
}

/**
 * The cell that names a file, by its row's `id`: where focus goes once what the file asked is
 * answered over the page (its columns, in a sheet), the action that asked it gone with the
 * question, so that the keyboard and screen readers stay on the file whose import goes on.
 */
export function fileCellOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[role="cell"][data-column="file"][data-file="${CSS.escape(id)}"]`,
  );
}

function CountCell({
  column,
  heading,
  value,
  locale,
}: {
  column: "added" | "known";
  heading: string;
  value: number | null;
  locale: string;
}) {
  return (
    <div
      role="cell"
      data-column={column}
      className={cn(
        "flex items-baseline gap-1.5 text-sm whitespace-nowrap tabular-nums md:justify-end",
        column === "added" ? "text-foreground max-md:order-2 max-md:ml-auto" : "max-md:order-3",
        column === "known" && "text-soft-foreground",
        value === null && "max-md:hidden",
      )}
    >
      <span className="text-xs text-muted-foreground md:hidden">{heading}</span>
      {value === null ? <Unknown /> : formatCount(value, locale)}
    </div>
  );
}

function FileRow({
  row,
  columns,
  locale,
}: {
  row: ImportFileRow;
  columns: ImportFilesColumns;
  locale: string;
}) {
  const open = present(row.content);

  const facts = [
    { key: "format", label: columns.format, value: row.format },
    { key: "account", label: columns.account, value: row.account },
    { key: "period", label: columns.period, value: row.period },
  ];

  return (
    <>
      <div
        role="row"
        data-slot="import-file"
        data-tone={row.tone ?? "neutral"}
        data-open={open || undefined}
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 py-3 md:col-span-full md:grid md:min-h-16 md:grid-cols-subgrid md:gap-y-0",
          !open && "border-b",
        )}
      >
        {/* Focus comes here from code once the file's question is answered (`fileCellOf`), its
            ring inside the row, whose neighbours touch it. */}
        <div
          role="cell"
          data-column="file"
          data-file={row.id}
          tabIndex={-1}
          className="flex min-w-0 basis-full flex-col gap-0.5 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <FileName name={row.file} />
          <span
            data-slot="import-file-facts"
            className="block text-xs text-soft-foreground md:truncate"
          >
            {facts.map((fact, at) => (
              <span key={fact.key} data-fact={fact.key}>
                {at === 0 ? null : (
                  <span aria-hidden="true" className="text-muted-foreground">
                    {" · "}
                  </span>
                )}
                <span className="sr-only">{`${fact.label}: `}</span>
                {fact.value === null ? <Unknown /> : fact.value}
              </span>
            ))}
          </span>
        </div>
        <CountCell column="added" heading={columns.added} value={row.added} locale={locale} />
        <CountCell column="known" heading={columns.known} value={row.known} locale={locale} />
        <div role="cell" data-column="state" className="flex min-w-0 max-md:order-1">
          <StatusChip tone={row.tone}>{row.state}</StatusChip>
        </div>
      </div>
      {open ? (
        <div role="row" data-slot="import-file-content" className="border-b md:col-span-full">
          <div role="cell" aria-colspan={4}>
            <Unfold>
              <div className="pb-3">{row.content}</div>
            </Unfold>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The files of an import, one row each (docs/wireframes, screen 6, block 2): first the file's name,
 * its facts set back under it (the format recognised, the account its lines go to, the period it
 * covers, each named for screen readers); then the lines new to the app and those it already
 * knows, right-aligned in tabular figures and fixed widths so that they line up from file to file;
 * then where it stands, as a `StatusChip`. Under a row, what the page puts there: the file's
 * `JobProgress`, a question to answer (`ImportPrompt`), a summary (`ImportSummary`). A value not
 * found yet shows a dash. It draws no block: the page puts it in one. The layout follows the 0.2
 * prototype (`docs/prototypes/0.2`, Import), which folds the wireframe's seven columns into four.
 *
 * A table on a wide screen (`role="table"`, its headers); on a phone, each file is a stack: its
 * name on two lines at most, its facts, then its state with its counts.
 *
 * Motion: a row's content unfolds when it appears (revealed from its top and faded in, 250 ms, ease-out); cut
 * under reduced motion, where it simply appears.
 */
export function ImportFiles({ label, columns, rows, locale }: ImportFilesProps) {
  const pageLocale = usePageLanguage();

  return (
    <div
      role="table"
      aria-label={label}
      data-slot="import-files"
      className="flex w-full flex-col md:grid md:grid-cols-import-files md:gap-x-4"
    >
      <div role="row" className="hidden border-b md:col-span-full md:grid md:grid-cols-subgrid">
        <div role="columnheader" className="py-2 text-xs font-medium text-muted-foreground">
          {columns.file}
        </div>
        <div
          role="columnheader"
          className="py-2 text-right text-xs font-medium text-muted-foreground"
        >
          {columns.added}
        </div>
        <div
          role="columnheader"
          className="py-2 text-right text-xs font-medium text-muted-foreground"
        >
          {columns.known}
        </div>
        <div role="columnheader" className="py-2 text-xs font-medium text-muted-foreground">
          {columns.state}
        </div>
      </div>
      {rows.map((row) => (
        <FileRow key={row.id} row={row} columns={columns} locale={locale ?? pageLocale} />
      ))}
    </div>
  );
}
