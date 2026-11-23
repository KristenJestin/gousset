import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { UnsupportedContent } from "./errors";
import { cleanValue, decodeText, quote } from "./text";

const decode = (bytes: Uint8Array) => Effect.runSync(decodeText(bytes));

describe("decoding a file's bytes", () => {
  test("drops a UTF-8 byte order mark, also before Windows-1252 text", () => {
    const bom = [0xef, 0xbb, 0xbf];
    const header = [...new TextEncoder().encode("!Type:Bank\n")];

    expect(decode(Uint8Array.from([...bom, ...header, 0xc3, 0xa9]))).toBe("!Type:Bank\né");
    // 0xE9 alone is no UTF-8: the bytes are Windows-1252, and the mark still goes.
    expect(decode(Uint8Array.from([...bom, ...header, 0xe9]))).toBe("!Type:Bank\né");
  });

  test("refuses a file larger than any statement, before decoding it", () => {
    const error = Effect.runSync(Effect.flip(decodeText(new Uint8Array(64 * 1024 * 1024 + 1))));

    expect(error).toEqual(
      new UnsupportedContent({
        line: 1,
        problem: "A file of more than 64 MiB: no statement is that large.",
      }),
    );
  });
});

// The characters under test are built from their code points, so that this file holds none raw.
const NEL = 0x85;
const LINE_SEPARATOR = 0x20_28;
const PARAGRAPH_SEPARATOR = 0x20_29;
const DELETE = 0x7f;
const RIGHT_TO_LEFT_OVERRIDE = 0x20_2e;
const LEFT_TO_RIGHT_ISOLATE = 0x20_66;
const ARABIC_LETTER_MARK = 0x06_1c;
const LANGUAGE_TAG = 0xe_00_01;
const ESCAPE = 0x1b;

const BACKSLASH = String.fromCodePoint(0x5c);

/** How `quote` writes a code point: `\u0085`, or `\u{e0001}` past the first plane. */
function escaped(code: number): string {
  const hexadecimal = code.toString(16);

  return code > 0xff_ff
    ? `${BACKSLASH}u{${hexadecimal}}`
    : `${BACKSLASH}u${hexadecimal.padStart(4, "0")}`;
}

describe("quoting the file's text in an error", () => {
  test("escapes every character that could break or reorder a log line", () => {
    const codes = [
      NEL,
      LINE_SEPARATOR,
      PARAGRAPH_SEPARATOR,
      DELETE,
      RIGHT_TO_LEFT_OVERRIDE,
      LEFT_TO_RIGHT_ISOLATE,
      ARABIC_LETTER_MARK,
      LANGUAGE_TAG,
      ESCAPE,
    ];

    const crafted = `a${String.fromCodePoint(...codes)}z`;

    expect(quote(crafted)).toBe(`"a${codes.map(escaped).join("")}z"`);
  });

  test("cuts a long text to 40 characters", () => {
    expect(quote("x".repeat(100))).toBe(`"${"x".repeat(40)}…"`);
  });
});

describe("cleaning a value", () => {
  test("turns every line break into a space and drops direction marks", () => {
    const text = [
      "ONE",
      String.fromCodePoint(NEL),
      "TWO",
      String.fromCodePoint(LINE_SEPARATOR),
      "THREE",
      String.fromCodePoint(PARAGRAPH_SEPARATOR),
      "FOUR",
      String.fromCodePoint(ARABIC_LETTER_MARK),
    ].join("");

    expect(cleanValue(text)).toBe("ONE TWO THREE FOUR");
  });
});
