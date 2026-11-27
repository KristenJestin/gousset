import { CSV_FIELDS } from "../lib/csv-fields";
import type { CsvField } from "../lib/csv-fields";
import { cn } from "../lib/utils";
import { Select } from "./select";

export type CsvMappingProps = {
  /** What the table shows, for screen readers ("The first lines of export.csv"). */
  label: string;
  /** Each column's name: the file's header, or the page's "Column 3" where it has none. */
  columns: ReadonlyArray<string>;
  /** The file's first lines, a value per column, as written in the file. */
  rows: ReadonlyArray<ReadonlyArray<string>>;
  /** Each field's name, in the page's words ("Booking date", "Ignored"), for those offered. */
  fields: { readonly [Field in CsvField]?: string };
  /**
   * The fields each column's list offers, in order: a statement's (`CSV_FIELDS`, the default), or
   * a broker's operations' (`OPERATION_FIELDS`).
   */
  offered?: ReadonlyArray<CsvField>;
  /** What each column holds, in the columns' order; a column left out is `ignored`. */
  mapping: ReadonlyArray<CsvField>;
  /** A column, counted from 1 as the profile counts it, now holds `field`. */
  onMappingChange: (column: number, field: CsvField) => void;
  /** The accessible name of a column's list, from its name ("What Libellé holds"). */
  chooseLabel: (column: string) => string;
};

/**
 * The first lines of a CSV file, where the user says what each column holds (docs/wireframes,
 * screen 6, block 3): above each column, a `Select` of the fields an import profile reads (booking
 * date, value date, label, memo, signed amount, debit, credit, bank id, currency, or a broker's
 * operation's: its kind, ISIN, quantity, unit price, fees…) or "ignored".
 * The values are shown as the file writes them. It draws no block: the page puts it in one. A wide
 * file scrolls sideways inside it.
 *
 * Motion: a column lights up as it is mapped, and goes back when ignored again: its cells take the
 * primary tint and its values the text's full colour in 200 ms, ease-out; cut under reduced
 * motion, where the tint changes at once.
 */
export function CsvMapping({
  label,
  columns,
  rows,
  fields,
  offered = CSV_FIELDS,
  mapping,
  onMappingChange,
  chooseLabel,
}: CsvMappingProps) {
  const items = offered.map((field) => ({ value: field, label: fields[field] ?? field }));

  // Each column by its number, counted from 1 as the profile and the errors count them.
  const numbered = columns.map((name, index) => {
    const field = mapping[index] ?? "ignored";

    return { name, number: index + 1, field, mapped: field === "ignored" ? undefined : true };
  });

  return (
    <div data-slot="csv-mapping" className="w-full overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {numbered.map((column) => (
              <th
                key={column.number}
                scope="col"
                data-column={column.number}
                data-mapped={column.mapped}
                className={cellClasses("min-w-40 border-b p-2 text-left align-bottom font-normal")}
              >
                <div className="flex flex-col gap-1.5">
                  <span className="truncate text-xs font-medium text-muted-foreground">
                    {column.name}
                  </span>
                  <Select
                    label={chooseLabel(column.name)}
                    hideLabel
                    size="sm"
                    items={items}
                    value={column.field}
                    onValueChange={(next) => {
                      const chosen = offered.find((field) => field === next);

                      if (chosen !== undefined) {
                        onMappingChange(column.number, chosen);
                      }
                    }}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, line) => (
            <tr key={line} data-slot="csv-mapping-row">
              {numbered.map((column) => (
                <td
                  key={column.number}
                  data-column={column.number}
                  data-mapped={column.mapped}
                  className={cellClasses(
                    "max-w-64 truncate border-b px-2 py-1.5 tabular-nums text-muted-foreground data-mapped:text-foreground",
                  )}
                >
                  {row[column.number - 1] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A cell of a column, which takes the tint while its column is mapped. */
function cellClasses(own: string) {
  return cn(own, "transition-colors duration-200 ease-out data-mapped:bg-primary/10");
}
