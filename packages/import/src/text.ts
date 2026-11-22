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

/** The text's lines, whatever ends them: `\r\n`, `\n` or a lone `\r`. */
export function splitLines(text: string): Array<string> {
  return text.split(/\r\n|\r|\n/);
}
