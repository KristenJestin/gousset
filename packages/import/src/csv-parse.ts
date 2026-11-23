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

/** A file's text, and the encoding it was read in. */
export type Decoded = { text: string; encoding: CsvEncoding };

function decodedOf(body: Uint8Array): Decoded {
  try {
    return { text: utf8.decode(body), encoding: "utf8" };
  } catch {
    return { text: windows1252.decode(body), encoding: "windows-1252" };
  }
}

function withoutBom(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
}

/**
 * Refuses a file of more than 64 MiB before anything reads it whole: decoding past the engine's
 * longest string would throw.
 */
export function checkSize(bytes: Uint8Array): Effect.Effect<void, UnsupportedContent> {
  if (bytes.length > MAX_FILE_BYTES) {
    return Effect.fail(
      new UnsupportedContent({
        line: 1,
        problem: "A file of more than 64 MiB: no statement is that large.",
      }),
    );
  }

  return Effect.void;
}

/**
 * A file's text read once, in the encoding its bytes show: UTF-8 when they are valid UTF-8,
 * Windows-1252 otherwise (README, "Encoding"). For detection, which has no profile to ask.
 */
export function decodeDetected(bytes: Uint8Array): Effect.Effect<Decoded, UnsupportedContent> {
  return Effect.map(checkSize(bytes), () => decodedOf(withoutBom(bytes)));
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
  return Effect.flatMap(checkSize(bytes), () => {
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
          problem:
            "Bytes that are not UTF-8, in a file the profile says is: it may be Windows-1252.",
        }),
      );
    }
  });
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

/** The most values a row may hold: a bank's export has a few dozen columns at most. */
const MAX_ROW_VALUES = 1000;

/**
 * The most values a file may hold, every row counted: years of a bank's statements hold some
 * hundred thousand. A file of line breaks or separators alone, under 64 MiB, would otherwise build
 * tens of millions of objects and run the server out of memory.
 */
const MAX_VALUES = 1_000_000;

/** A row with nothing in it: a blank line, or separators alone. */
export function isBlank(row: CsvRow): boolean {
  return row.cells.every((cell) => cell.text.trim() === "");
}

/**
 * How much of a text to read: the rows kept, the lines and the characters, the first limit reached
 * stopping it at the start of a row. Detection reads a sample so; the reader reads it all.
 */
export type ParseLimit = { rows: number; lines: number; characters: number };

const WHOLE: ParseLimit = {
  rows: Number.POSITIVE_INFINITY,
  lines: Number.POSITIVE_INFINITY,
  characters: Number.POSITIVE_INFINITY,
};

/**
 * The rows of a CSV text that hold something, blank ones left out as they are read, each value
 * with the line and the column it starts at; `firstLine` is the number of the text's first line in
 * the file. It reads what `limit` lets it, dropping a row the character limit cuts, and at most a
 * thousand values a row and a million in all (`UnsupportedContent` past them). Linear in the
 * length it reads, whatever the text holds.
 */
export function parseRows(
  text: string,
  separator: string,
  firstLine: number,
  limit: ParseLimit = WHOLE,
): Effect.Effect<Array<CsvRow>, MalformedFile | UnsupportedContent> {
  const rows: Array<CsvRow> = [];
  const end = Math.min(text.length, limit.characters);
  const cut = end < text.length;
  let cells: Array<CsvCell> = [];
  let values = 0;
  let rowLine = firstLine;
  let line = firstLine;
  let index = 0;

  const keep = (row: CsvRow) => {
    if (!isBlank(row)) {
      rows.push(row);
      values += row.cells.length;
    }
  };

  while (index < end) {
    if (cells.length === 0 && (rows.length >= limit.rows || line - firstLine >= limit.lines)) {
      break;
    }

    const column = cells.length + 1;
    const cellLine = line;
    let value: string;

    if (column > MAX_ROW_VALUES) {
      return Effect.fail(
        new UnsupportedContent({
          line: rowLine,
          column,
          problem: `A row of more than ${String(MAX_ROW_VALUES)} values: no bank writes so many columns.`,
        }),
      );
    }

    if (values + cells.length >= MAX_VALUES) {
      return Effect.fail(
        new UnsupportedContent({
          line: rowLine,
          problem: "More than a million values in the file: no statement is that large.",
        }),
      );
    }

    if (text[index] === '"') {
      index += 1;

      const start = index;
      let closed = false;
      let doubled = false;

      while (index < end) {
        if (text[index] === '"') {
          if (text[index + 1] !== '"') {
            closed = true;
            break;
          }

          doubled = true;
          index += 1;
        } else if (endsLine(text, index)) {
          line += 1;
        }

        index += 1;
      }

      // One slice and one replacement: joining the pieces between `""` one by one would chain a
      // string per pair, a gigabyte for a file of quotes.
      value = text.slice(start, index);
      value = doubled ? value.replaceAll('""', '"') : value;
      index += 1;

      if (!closed && cut) {
        cells = [];
        break;
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
        index < end &&
        text[index] !== separator &&
        text[index] !== "\r" &&
        text[index] !== "\n"
      ) {
        index += 1;
      }

      value = text.slice(start, index);
    }

    // The character limit cut the row: it is left out, as the rows after it.
    if (cut && index >= end) {
      cells = [];
      break;
    }

    cells.push({ text: value, line: cellLine, column });

    if (text[index] === separator) {
      index += 1;
      continue;
    }

    keep({ line: rowLine, cells });
    cells = [];
    index += text[index] === "\r" && text[index + 1] === "\n" ? 2 : 1;
    line += 1;
    rowLine = line;
  }

  // A separator ends the text: the row's last value is empty.
  if (cells.length > 0 && !cut) {
    cells.push({ text: "", line, column: cells.length + 1 });
    keep({ line: rowLine, cells });
  }

  return Effect.succeed(rows);
}
