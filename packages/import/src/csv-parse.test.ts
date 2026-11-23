import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { parseRows, skipLines } from "./csv-parse";

const parse = (text: string, separator: string) => Effect.runSync(parseRows(text, separator, 1));

/** Values with what a CSV writer must quote: separators, quotes, every kind of line break. */
const values = fc.stringMatching(/^[a-zé€ 0-9;,|\t"\r\n]{0,8}$/);

const grids = fc.array(fc.array(values, { minLength: 1, maxLength: 6 }), { maxLength: 8 });

function quoted(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

describe("cutting a CSV text into rows", () => {
  test("reads back any table written with every value quoted, whatever the line ends", () => {
    const dialects = fc.record({
      separator: fc.constantFrom(";", ",", "\t", "|"),
      end: fc.constantFrom("\r\n", "\n", "\r"),
    });

    fc.assert(
      fc.property(grids, dialects, (grid, { separator, end }) => {
        const text = grid.map((row) => row.map(quoted).join(separator)).join(end);
        const rows = parse(text, separator);

        expect(rows.map((row) => row.cells.map((cell) => cell.text))).toEqual(grid);
      }),
    );
  });

  test("numbers each row by the line it starts on, line breaks inside values counted", () => {
    const rows = parse('a;"b\r\nc"\r\nd;"e\nf\rg"\nh', ";");

    expect(rows.map((row) => row.line)).toEqual([1, 3, 6]);
    expect(rows[1]?.cells.map((cell) => [cell.line, cell.column, cell.text])).toEqual([
      [3, 1, "d"],
      [3, 2, "e\nf\rg"],
    ]);
  });

  test("keeps a quote inside a value that does not start with one, and empty values", () => {
    expect(parse('5" PIZZA;;\n;x\n', ";").map((row) => row.cells.map((cell) => cell.text))).toEqual(
      [
        ['5" PIZZA', "", ""],
        ["", "x"],
      ],
    );
  });

  test("skips the first lines, whatever ends them", () => {
    expect(skipLines("a\r\nb\rc\nd", 3)).toEqual({ rest: "d", line: 4 });
    expect(skipLines("a\nb", 0)).toEqual({ rest: "a\nb", line: 1 });
    expect(skipLines("a\n", 5)).toEqual({ rest: "", line: 2 });
  });

  test("reads a long file in time linear in its size", () => {
    const text = `${"x;".repeat(200_000)}"${"y".repeat(200_000)}"\n`.repeat(5);

    expect(parse(text, ";")).toHaveLength(5);
  });
});
