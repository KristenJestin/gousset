import { Effect } from "effect";

import { MalformedFile, UnsupportedContent } from "./errors";
import { MAX_FILE_BYTES } from "./text";

// CSV as banks write it (RFC 4180, leniently): values separated by one character, rows ended by
// CRLF, LF or a lone CR; a value in double quotes may hold the separator, a line break, and a quote
// written twice (`""`). A quote inside a value that does not start with one is only a character.

/** A value of a row, as written between its separators, its quotes taken off. */
export type CsvCell = { text: string; line: number; column: number };

/** A row of the file and the line it starts on, counted from 1. */
export type CsvRow = { line: number; cells: Array<CsvCell> };

export type CsvEncoding = "utf8" | "windows-1252";

/** A text past the lines skipped, and the number in the file of the line it starts on. */
export type Skipped = { rest: string; line: number };

const utf8 = new TextDecoder("utf-8", { fatal: true });
const windows1252 = new TextDecoder("windows-1252");

/** The line of the first bytes that are not UTF-8: no line break byte is part of a character. */
function firstLineNotUtf8(bytes: Uint8Array): number {
  let line = 1;
  let start = 0;

  for (let index = 0; index <= bytes.length; index += 1) {
    const byte = bytes[index];

    if (index === bytes.length || byte === 0x0a || byte === 0x0d) {
      try {
        utf8.decode(bytes.subarray(start, index));
      } catch {
        return line;
      }

      if (byte === 0x0d && bytes[index + 1] === 0x0a) {
        index += 1;
      }

      line += 1;
      start = index + 1;
    }
  }

  return line;
}

/** Whether the bytes, past a byte order mark, are valid UTF-8. */
export function isUtf8(bytes: Uint8Array): boolean {
  try {
    utf8.decode(withoutBom(bytes));

    return true;
  } catch {
    return false;
  }
}

function withoutBom(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
}

/**
 * A CSV file's text in the profile's encoding, its byte order mark dropped (an editor may write
 * one before Windows-1252 text). A file said to be UTF-8 that is not is refused at the line of its
 * first wrong bytes, rather than read with replacement characters in its labels.
 */
export function decodeCsv(
  bytes: Uint8Array,
  encoding: CsvEncoding,
): Effect.Effect<string, MalformedFile | UnsupportedContent> {
  if (bytes.length > MAX_FILE_BYTES) {
    return Effect.fail(
      new UnsupportedContent({
        line: 1,
        problem: "A file of more than 64 MiB: no statement is that large.",
      }),
    );
  }

  const body = withoutBom(bytes);

  if (encoding === "windows-1252") {
    return Effect.succeed(windows1252.decode(body));
  }

  try {
    return Effect.succeed(utf8.decode(body));
  } catch {
    return Effect.fail(
      new MalformedFile({
        line: firstLineNotUtf8(body),
        problem: "Bytes that are not UTF-8, in a file the profile says is: it may be Windows-1252.",
      }),
    );
  }
}

/** The text past its first `count` lines, whatever ends them. */
export function skipLines(text: string, count: number): Skipped {
  let index = 0;
  let skipped = 0;

  while (skipped < count && index < text.length) {
    const character = text[index];

    index += 1;

    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index] === "\n") {
        index += 1;
      }

      skipped += 1;
    }
  }

  return { rest: text.slice(index), line: skipped + 1 };
}

function endsLine(text: string, index: number): boolean {
  const character = text[index];

  return character === "\n" || (character === "\r" && text[index + 1] !== "\n");
}

/**
 * The rows of a CSV text, each value with the line and the column it starts at; `firstLine` is the
 * number of the text's first line in the file. Linear in the text's length, whatever it holds.
 */
export function parseRows(
  text: string,
  separator: string,
  firstLine: number,
): Effect.Effect<Array<CsvRow>, MalformedFile> {
  const rows: Array<CsvRow> = [];
  let cells: Array<CsvCell> = [];
  let rowLine = firstLine;
  let line = firstLine;
  let index = 0;

  while (index < text.length) {
    const column = cells.length + 1;
    const cellLine = line;
    let value = "";

    if (text[index] === '"') {
      index += 1;

      let start = index;
      let closed = false;

      while (index < text.length) {
        if (text[index] === '"') {
          value += text.slice(start, index);
          index += 1;

          if (text[index] !== '"') {
            closed = true;
            break;
          }

          start = index;
        } else if (endsLine(text, index)) {
          line += 1;
        }

        index += 1;
      }

      if (!closed) {
        return Effect.fail(
          new MalformedFile({
            line: cellLine,
            column,
            problem: "A quoted value that never ends: the file may be cut short.",
          }),
        );
      }

      const next = text[index];

      if (next !== undefined && next !== separator && next !== "\r" && next !== "\n") {
        return Effect.fail(
          new MalformedFile({
            line,
            column,
            problem:
              'Text after a quoted value\'s closing quote: a quote inside a value is written twice ("").',
          }),
        );
      }
    } else {
      const start = index;

      while (
        index < text.length &&
        text[index] !== separator &&
        text[index] !== "\r" &&
        text[index] !== "\n"
      ) {
        index += 1;
      }

      value = text.slice(start, index);
    }

    cells.push({ text: value, line: cellLine, column });

    if (text[index] === separator) {
      index += 1;
      continue;
    }

    rows.push({ line: rowLine, cells });
    cells = [];
    index += text[index] === "\r" && text[index + 1] === "\n" ? 2 : 1;
    line += 1;
    rowLine = line;
  }

  // A separator ends the text: the row's last value is empty.
  if (cells.length > 0) {
    cells.push({ text: "", line, column: cells.length + 1 });
    rows.push({ line: rowLine, cells });
  }

  return Effect.succeed(rows);
}

/** A row with nothing in it: a blank line, or separators alone. */
export function isBlank(row: CsvRow): boolean {
  return row.cells.every((cell) => cell.text.trim() === "");
}
