import { Effect } from "effect";

import { UnsupportedContent } from "./errors";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const windows1252 = new TextDecoder("windows-1252");

/**
 * The largest file read, 64 MiB. Years of a bank's statements weigh a few megabytes; refusing more
 * keeps the decoded text well under the engine's longest string, past which decoding throws.
 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

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

/**
 * XML's entities and the few SGML files use, named or numeric; a bare `&`, as some banks write,
 * stays as it is. No other entity is ever defined: the readers read no document type declaration.
 */
export function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
    if (!name.startsWith("#")) {
      return ENTITIES.get(name.toLowerCase()) ?? entity;
    }

    const hexadecimal = name.startsWith("#x") || name.startsWith("#X");
    const code = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);

    // Unicode's last code point, U+10FFFF: anything above is no character.
    return code <= 1_114_111 ? String.fromCodePoint(code) : entity;
  });
}

/**
 * An IBAN as the readers return it, upper case without spaces (`FR76 9999 …` is
 * `FR769999…`); `null` when the text is not shaped as one (a domestic account number).
 */
export function ibanOf(text: string | null): string | null {
  const compact = (text ?? "").replaceAll(/\s/g, "").toUpperCase();

  return /^[A-Z]{2}\d{2}[A-Z\d]{11,30}$/.test(compact) ? compact : null;
}

/** The text, or `null` when it is empty. */
export function nonEmpty(text: string): string | null {
  return text === "" ? null : text;
}

/** The text's lines, whatever ends them: `\r\n`, `\n` or a lone `\r`. */
export function splitLines(text: string): Array<string> {
  return text.split(/\r\n|\r|\n/);
}
