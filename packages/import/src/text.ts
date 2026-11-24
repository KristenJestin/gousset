import { Effect } from "effect";

import { UnsupportedContent } from "./errors";
import type { StatementAccount } from "./statement";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const windows1252 = new TextDecoder("windows-1252");

/**
 * The largest file read, 64 MiB. Years of a bank's statements weigh a few megabytes; refusing more
 * keeps the decoded text well under the engine's longest string, past which decoding throws.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * A file's text from its bytes: UTF-8 when the bytes are valid UTF-8, Windows-1252 otherwise,
 * whatever the file declares. Banks' declarations are often wrong (an OFX `CHARSET:1252` over UTF-8
 * bytes, a QIF declares nothing), while accented Windows-1252 text is almost never valid UTF-8 by
 * chance. Windows-1252 also reads Latin-1 (ISO-8859-1): they differ only on 0x80 to 0x9F, control
 * codes in Latin-1 that no statement holds. A UTF-8 byte order mark is dropped in both cases: an
 * editor may add one to a file it saves as Windows-1252.
 */
export function decodeText(bytes: Uint8Array): Effect.Effect<string, UnsupportedContent> {
  if (bytes.length > MAX_FILE_BYTES) {
    return Effect.fail(
      new UnsupportedContent({
        line: 1,
        problem: "A file of more than 64 MiB: no statement is that large.",
      }),
    );
  }

  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;

  try {
    return Effect.succeed(utf8.decode(body));
  } catch {
    return Effect.succeed(windows1252.decode(body));
  }
}

/**
 * A value as the readers return it: a tab or a line break inside it (NEL and Unicode's line and
 * paragraph separators included) becomes a space, and the characters a label never shows are
 * dropped (NUL and the other control codes, which Postgres or a terminal choke on, half surrogate
 * pairs, and the direction controls that would make a payee read backwards).
 */
export function cleanValue(text: string): string {
  return text
    .replaceAll(/[\t\n\v\f\r\u0085\p{Zl}\p{Zp}]/gu, " ")
    .replaceAll(/[\p{Cc}\p{Cs}\p{Bidi_Control}]/gu, "")
    .trim();
}

const EXCERPT_LENGTH = 40;

/** The file's own text cut to 40 characters, as an error carries it. */
export function excerpt(text: string): string {
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;
}

/** What `JSON.stringify` leaves raw and a log must not hold: NEL, DEL, format and bidi controls, line and paragraph separators. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function escapeCharacter(character: string): string {
  const code = (character.codePointAt(0) ?? 0).toString(16);

  return code.length > 4 ? `\\u{${code}}` : `\\u${code.padStart(4, "0")}`;
}

/**
 * The file's own text as an error sentence quotes it: cut short, in quotes, every control, format
 * and separator character escaped, so that a crafted file cannot write a long line, a line of its
 * own, or text that reads backwards, into a log.
 */
export function quote(text: string): string {
  return JSON.stringify(excerpt(text)).replaceAll(UNSAFE, escapeCharacter);
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/** What may stand between an entity's `&` and its `;`. */
const NAME_PART = /^[\da-z#]+$/i;

const ENTITY_NAME = /^(?:#x[\da-f]+|#\d+|[a-z]+)$/i;

/** The character an entity's name (`apos`, `#39`, `#x27`) stands for; `undefined` for none. */
function characterOf(name: string): string | undefined {
  if (!ENTITY_NAME.test(name)) {
    return undefined;
  }

  if (!name.startsWith("#")) {
    return ENTITIES.get(name.toLowerCase());
  }

  const hexadecimal = name.startsWith("#x") || name.startsWith("#X");
  const code = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);

  // Unicode's last code point, U+10FFFF: anything above is no character.
  return code <= 1_114_111 ? String.fromCodePoint(code) : undefined;
}

/**
 * Replaces the entity `pieces` end with, if they end with one (`&`, a name, `;`), by its
 * character, and says whether it did. Only the pieces since the last `&` are read, and a failed
 * look leaves its `;` behind for the next one to stop at: each piece is read a bounded number of
 * times.
 */
function replaceLastEntity(pieces: Array<string>): boolean {
  const name: Array<string> = [];

  for (let at = pieces.length - 2; at >= 0; at -= 1) {
    const piece = pieces[at] ?? "";

    if (piece === "&") {
      const character = characterOf(name.toReversed().join(""));

      if (character === undefined) {
        return false;
      }

      pieces.length = at;
      pieces.push(character);

      return true;
    }

    if (!NAME_PART.test(piece)) {
      return false;
    }

    name.push(piece);
  }

  return false;
}

/**
 * XML's entities and the few SGML files use, named or numeric, decoded until none is left (#132):
 * some banks encode their text twice, `&amp;apos;` for an apostrophe, and the label is the text
 * they meant, `'`. A bare `&`, as some banks write, and what names no entity stay as they are. No
 * other entity is ever defined: the readers read no document type declaration.
 *
 * Entities never overlap, so whatever order they are decoded in, the text ends the same: this
 * reads it once, from left to right, and decodes an entity as soon as its `;` comes, also when an
 * entity decoded just before gave that `;` or completed its name (`&amp;apos;`). Linear in the
 * text's length, where decoding one level per pass would take as many passes as the levels.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) {
    return text;
  }

  // The text decoded so far: each `&` and `;` a piece of its own, the text between them whole.
  const pieces: Array<string> = [];

  for (const [piece] of text.matchAll(/[^&;]+|[&;]/g)) {
    pieces.push(piece);

    let replaced = piece === ";";

    // A decoded `;` (`&#59;`) may close the entity before it in turn.
    while (replaced) {
      replaced = pieces.at(-1) === ";" && replaceLastEntity(pieces);
    }
  }

  return pieces.join("");
}

/**
 * An IBAN as the readers return it, upper case without spaces (`FR76 9999 …` is
 * `FR769999…`); `null` when the text is not shaped as one (a domestic account number).
 */
export function ibanOf(text: string | null): string | null {
  const compact = (text ?? "").replaceAll(/\s/g, "").toUpperCase();

  return /^[A-Z]{2}\d{2}[A-Z\d]{11,30}$/.test(compact) ? compact : null;
}

/** An account as a statement names it, `null` when it gives neither its IBAN nor its number. */
export function statementAccount(
  iban: string | null,
  number: string | null,
): StatementAccount | null {
  return iban === null && number === null ? null : { iban, number };
}

/** The text, or `null` when it is empty. */
export function nonEmpty(text: string): string | null {
  return text === "" ? null : text;
}

/** The text's lines, whatever ends them: `\r\n`, `\n` or a lone `\r`. */
export function splitLines(text: string): Array<string> {
  return text.split(/\r\n|\r|\n/);
}
