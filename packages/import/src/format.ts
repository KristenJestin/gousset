/**
 * The formats a statement file may be in: exactly the values of the database's `import_format`
 * (`docs/data-model.md`). QFX is OFX with Intuit's tags, read by the same reader.
 */
export type StatementFormat = "ofx" | "qfx" | "qif" | "camt053" | "mt940" | "csv";

/** How much of the file is looked at: every format says what it is within its first lines. */
const HEAD_BYTES = 4096;

// Lenient: a byte that is not UTF-8 (a Windows-1252 accent, a character the cut split) becomes a
// replacement character, never an error; the byte order mark is dropped.
const decoder = new TextDecoder("utf-8");

/** An OFX header (`OFXHEADER:100`, `<?OFX OFXHEADER="200"`) or the `<OFX>` element. */
const OFX = /OFXHEADER|<OFX[\s>]/i;

/** Intuit's tag, in QFX's header or signon (`<INTU.BID>`). */
const INTUIT = /INTU\.BID/i;

/** CAMT.053's message element, maybe under a namespace prefix, or its namespace. */
const CAMT053 = /<(?:[\w.-]+:)?BkToCstmrStmt[\s>]|camt\.053/;

/** QIF's headers: `!Type:Bank`, `!Account`, Quicken's `!Option:AutoSwitch` before them. */
const QIF_START = /^!(?:type:|account|option:|clear:)/i;

const QIF_HEADER = /^!(?:type:|account)/im;

/** MT940's statement reference (`:20:`), then the account, a balance or a line. */
const MT940_REFERENCE = /^:20:/m;

const MT940_FIELD = /^:(?:25|28C|60[FM]|61):/m;

const SEPARATOR = /[;,\t|]/;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");

  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function isMt940(head: string): boolean {
  if (head.startsWith("{1:")) {
    return true;
  }

  const reference = MT940_REFERENCE.exec(head);

  return reference !== null && MT940_FIELD.test(head.slice(reference.index));
}

/**
 * The format a file is in, from its first 4 KiB and its name, for the import screen to propose
 * before anything is read; `null` when nothing says. Pure and cheap: no reader runs, and a file the
 * guess gets wrong is refused by the reader with a typed error.
 *
 * OFX (an `OFXHEADER` header or an `<OFX>` element) is `qfx` when the name ends in `.qfx` or the
 * file holds Intuit's `INTU.BID`; then CAMT.053 (`BkToCstmrStmt`, or its `camt.053` namespace),
 * QIF (`!Type:`, `!Account` at the start), MT940 (SWIFT's `{1:` block, or `:20:` followed by
 * `:25:`, `:28C:`, `:60F:` or `:61:`), and CSV when the name ends in `.csv` or `.txt` or the first
 * line holds a separator (`;`, `,`, a tab, `|`).
 */
export function detectFormat(bytes: Uint8Array, fileName: string): StatementFormat | null {
  const head = decoder.decode(bytes.subarray(0, HEAD_BYTES)).trimStart();
  const extension = extensionOf(fileName);

  if (head === "") {
    return null;
  }

  if (OFX.test(head)) {
    return extension === "qfx" || INTUIT.test(head) ? "qfx" : "ofx";
  }

  if (CAMT053.test(head)) {
    return "camt053";
  }

  if (QIF_START.test(head) && QIF_HEADER.test(head)) {
    return "qif";
  }

  if (isMt940(head)) {
    return "mt940";
  }

  const firstLine = head.split(/\r\n|\r|\n/, 1)[0] ?? "";

  if (extension === "csv" || extension === "txt" || SEPARATOR.test(firstLine)) {
    return "csv";
  }

  return null;
}
