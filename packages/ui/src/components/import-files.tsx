import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { Unfold } from "./unfold";

/** The column headers, in the page's words. */
export type ImportFilesColumns = {
  file: string;
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
  /** The account the lines go to: a `Select` to choose it, or its name. `null` shows a dash. */
  account: ReactNode;
  /** The period the file covers ("1–31 Oct."); `null` while unknown. */
  period: string | null;
  /** Lines new to the app; `null` while not counted. */
  added: number | null;
  /** Lines the app already knows; `null` while not counted. */
  known: number | null;
  /** Where the file stands, in the page's words ("ready", "to map"). */
  state: string;
  /** The file waits for the user (a question to answer) or failed: its state stands out. */
  attention?: boolean;
  /**
   * Shown under the row, across it: the file's `JobProgress`, a question to answer, a summary.
   * It unfolds when it appears.
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

type ColumnKey = keyof ImportFilesColumns;

const COLUMN_KEYS: ReadonlyArray<ColumnKey> = [
  "file",
  "format",
  "account",
  "period",
  "added",
  "known",
  "state",
];

function isCount(key: ColumnKey) {
  return key === "added" || key === "known";
}

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

/**
 * One cell. On a phone each cell is a line of the row's stack, its column's name before its
 * value; on a wide screen the name is the column's header and the cell sits in its column.
 */
function Cell({
  column,
  heading,
  children,
}: {
  column: ColumnKey;
  heading: string;
  children: ReactNode;
}) {
  const count = isCount(column);
  const file = column === "file";

  return (
    <div
      role="cell"
      data-column={column}
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 text-sm md:px-3 md:py-2.5",
        count && "tabular-nums md:justify-end",
        file && "font-medium text-foreground",
      )}
    >
      {file ? null : <span className="shrink-0 text-muted-foreground md:hidden">{heading}</span>}
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          file ? "break-all" : "justify-end text-right md:justify-start md:text-left",
          count && "md:justify-end md:text-right",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function present(node: ReactNode) {
  return node !== null && node !== undefined && node !== false;
}

function text(value: string | null) {
  return value === null ? <Unknown /> : value;
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

  const count = (value: number | null) =>
    value === null ? <Unknown /> : formatCount(value, locale);

  return (
    <>
      <div
        role="row"
        data-slot="import-file"
        data-attention={row.attention === true || undefined}
        data-open={open || undefined}
        className={cn(
          "flex flex-col gap-1.5 py-3 md:col-span-full md:grid md:grid-cols-subgrid md:gap-0 md:py-0",
          !open && "border-b",
        )}
      >
        <Cell column="file" heading={columns.file}>
          {row.file}
        </Cell>
        <Cell column="format" heading={columns.format}>
          {text(row.format)}
        </Cell>
        <Cell column="account" heading={columns.account}>
          {present(row.account) ? row.account : <Unknown />}
        </Cell>
        <Cell column="period" heading={columns.period}>
          {text(row.period)}
        </Cell>
        <Cell column="added" heading={columns.added}>
          {count(row.added)}
        </Cell>
        <Cell column="known" heading={columns.known}>
          {count(row.known)}
        </Cell>
        <Cell column="state" heading={columns.state}>
          {row.attention === true ? (
            <span className="flex shrink-0">
              <Icon name="warning" size="sm" />
            </span>
          ) : null}
          <span className={cn(row.attention === true && "font-medium text-foreground")}>
            {row.state}
          </span>
        </Cell>
      </div>
      {open ? (
        <div role="row" data-slot="import-file-content" className="border-b md:col-span-full">
          <div role="cell" aria-colspan={COLUMN_KEYS.length}>
            <Unfold>
              <div className="pb-4 md:px-3 md:pt-1">{row.content}</div>
            </Unfold>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The files of an import, one row each (docs/wireframes, screen 6, block 2): its name, the
 * format recognised, the account its lines go to (the page's `Select`, or a name), the period it
 * covers, the lines new to the app and those it already knows, and where it stands. Under a row,
 * what the page puts there: the file's `JobProgress`, a question to answer, a summary. A value not
 * known yet shows a dash. It draws no block: the page puts it in one.
 *
 * A table on a wide screen (`role="table"`, its headers, counts right-aligned in tabular
 * figures); on a phone, each file is a stack of lines, each naming its column.
 *
 * Motion: a row's content unfolds when it appears (height and opacity, 250 ms, ease-out); cut
 * under reduced motion, where it simply appears.
 */
export function ImportFiles({ label, columns, rows, locale }: ImportFilesProps) {
  const pageLocale = usePageLanguage();

  return (
    <div
      role="table"
      aria-label={label}
      data-slot="import-files"
      className="flex w-full flex-col md:grid md:grid-cols-import-files"
    >
      <div role="row" className="hidden border-b md:col-span-full md:grid md:grid-cols-subgrid">
        {COLUMN_KEYS.map((key) => (
          <div
            key={key}
            role="columnheader"
            className={cn(
              "px-3 py-2 text-xs font-medium text-muted-foreground",
              isCount(key) && "text-right",
            )}
          >
            {columns[key]}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <FileRow key={row.id} row={row} columns={columns} locale={locale ?? pageLocale} />
      ))}
    </div>
  );
}
