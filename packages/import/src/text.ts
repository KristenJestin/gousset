const utf8 = new TextDecoder("utf-8", { fatal: true });
const windows1252 = new TextDecoder("windows-1252");

/**
 * A file's text from its bytes: UTF-8 when the bytes are valid UTF-8, Windows-1252 otherwise,
 * whatever the file declares. Banks' declarations are often wrong (an OFX `CHARSET:1252` over UTF-8
 * bytes, a QIF declares nothing), while accented Windows-1252 text is almost never valid UTF-8 by
 * chance. Windows-1252 also reads Latin-1 (ISO-8859-1): they differ only on 0x80 to 0x9F, control
 * codes in Latin-1 that no statement holds. A UTF-8 byte order mark is dropped.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return windows1252.decode(bytes);
  }
}

/**
 * A value as the readers return it: a tab or a line break inside it becomes a space, and the
 * characters a label never shows are dropped (NUL and the other control codes, which Postgres or a
 * terminal choke on, half surrogate pairs, and the direction marks that would make a payee read
 * backwards).
 */
export function cleanValue(text: string): string {
  return text
    .replaceAll(/[\t\n\v\f\r]/g, " ")
    .replaceAll(/[\p{Cc}\p{Cs}‎‏‪-‮⁦-⁩]/gu, "")
    .trim();
}

const EXCERPT_LENGTH = 40;

/**
 * The file's own text as an error sentence quotes it: cut short, in quotes, its control codes
 * escaped, so that a crafted file cannot write a long line, or a line of its own, into a log.
 */
export function quote(text: string): string {
  const excerpt = text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;

  return JSON.stringify(excerpt);
}

/** The text's lines, whatever ends them: `\r\n`, `\n` or a lone `\r`. */
export function splitLines(text: string): Array<string> {
  return text.split(/\r\n|\r|\n/);
}
