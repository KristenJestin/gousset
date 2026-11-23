import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { UnsupportedContent } from "./errors";
import { parseRows, skipLines } from "./csv-parse";

const parse = (text: string, separator: string) => Effect.runSync(parseRows(text, separator, 1));

const refusal = (text: string, separator: string) =>
  Effect.runSync(Effect.flip(parseRows(text, separator, 1)));

/** The lines of the rows read within those limits. */
const sample = (text: string, rows: number, lines: number, characters: number) =>
  Effect.runSync(parseRows(text, ";", 1, { rows, lines, characters })).map((row) => row.line);

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

        // Rows of blank values alone are left out as they are read.
        const kept = grid.filter((row) => row.some((value) => value.trim() !== ""));

        expect(rows.map((row) => row.cells.map((cell) => cell.text))).toEqual(kept);
      }),
    );
  });

  test("numbers each row by the line it starts on, line breaks inside values counted", () => {
    const rows = parse('a;"b\r\nc"\r\n\r\nd;"e\nf\rg"\n;\nh', ";");

    expect(rows.map((row) => row.line)).toEqual([1, 4, 8]);
    expect(rows[1]?.cells.map((cell) => [cell.line, cell.column, cell.text])).toEqual([
      [4, 1, "d"],
      [4, 2, "e\nf\rg"],
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

  test("stops after the rows, the lines or the characters asked for, at a row's start", () => {
    const all = Number.POSITIVE_INFINITY;

    expect(sample("a\n\nb\nc\nd\n", 2, all, all)).toEqual([1, 3]);
    expect(sample("a\n\n\nb\nc\n", all, 3, all)).toEqual([1]);
    expect(sample("aaaa;b\ncccccccc;d\ne\n", all, all, 10)).toEqual([1]);

    // A quoted value the limit cuts is no error: the file goes on past it.
    expect(sample('a\n"bbbbbbbbbbbb\nb"\n', all, all, 8)).toEqual([1]);
  });

  test("reads a value of many quotes written twice", () => {
    const rows = parse(`"${'""'.repeat(1_000_000)}";x\n`, ";");

    expect(rows[0]?.cells.map((cell) => cell.text)).toEqual(['"'.repeat(1_000_000), "x"]);
  });

  test("skips the first lines, whatever ends them", () => {
    expect(skipLines("a\r\nb\rc\nd", 3)).toEqual({ rest: "d", line: 4 });
    expect(skipLines("a\nb", 0)).toEqual({ rest: "a\nb", line: 1 });
    expect(skipLines("a\n", 5)).toEqual({ rest: "", line: 2 });
  });

  test("reads a long file in time linear in its size", () => {
    const text = `x;"${"y".repeat(1000)}";z\n`.repeat(10_000);

    expect(parse(text, ";")).toHaveLength(10_000);
  });

  test("builds nothing for a file of line breaks or separators alone", () => {
    expect(parse("\n".repeat(4 * 1024 * 1024), ";")).toEqual([]);
    expect(parse(`${";".repeat(999)}\n`.repeat(16 * 1024), ";")).toEqual([]);
  });

  test("refuses a row of more than a thousand values", () => {
    expect(refusal(`a;b\n${"x;".repeat(1000)}x\n`, ";")).toEqual(
      new UnsupportedContent({
        line: 2,
        column: 1001,
        problem: "A row of more than 1000 values: no bank writes so many columns.",
      }),
    );

    expect(refusal(";".repeat(16 * 1024 * 1024), ";")).toBeInstanceOf(UnsupportedContent);
  });

  test("refuses a file of more than a million values", () => {
    expect(refusal("a;b\n".repeat(500_001), ";")).toEqual(
      new UnsupportedContent({
        line: 500_001,
        problem: "More than a million values in the file: no statement is that large.",
      }),
    );
  });
});
