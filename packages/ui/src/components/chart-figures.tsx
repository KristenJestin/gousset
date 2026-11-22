import { useId, useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { Button } from "./button";
import { Skeleton } from "./skeleton";

export type ChartFiguresProps = {
  /** What the chart shows, the table's caption: "Spending in October, against September". */
  caption: string;
  /** The columns' headers: the first names the row (a day, a month), the others its figures. */
  columns: ReadonlyArray<string>;
  /** One row per point of the chart, its cells already written (amounts formatted). */
  rows: ReadonlyArray<{ key: string; cells: ReadonlyArray<string> }>;
};

/**
 * A chart's figures as a table, behind a button under the chart: the chart itself follows the
 * pointer only, so this is how the keyboard and screen readers reach every amount it draws.
 */
export function ChartFigures({ caption, columns, rows }: ChartFiguresProps) {
  const messages = useUiMessages().charts;
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? messages.hideFigures : messages.showFigures}
      </Button>
      <table id={id} hidden={!open} className="w-full text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {columns.map((column) => (
              <th key={column} scope="col" className="py-1 pr-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-b-0">
              {row.cells.map((cell, index) =>
                index === 0 ? (
                  <th key={columns[index]} scope="row" className="py-1 pr-3 text-left font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={columns[index]} className="py-1 pr-3">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The figures' button on its way, the same height, for a chart's skeleton. */
export function ChartFiguresSkeleton() {
  return (
    <span className="flex h-8 items-center">
      <Skeleton className="h-3 w-28" />
    </span>
  );
}
