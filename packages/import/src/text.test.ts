import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { UnsupportedContent } from "./errors";
import { cleanValue, decodeEntities, decodeText, quote } from "./text";

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

/** Text as an XML writer escapes it: `&` first, so that what it writes is not escaped again. */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Text rich in what entities are made of, so that the properties meet them often. */
const entityLike = fc
  .array(
    fc.oneof(
      fc.constantFrom("&", ";", "#", "x", "amp", "apos", "AMP", "lt", "#39", "#x26", "#59"),
      fc.string({ maxLength: 3 }),
    ),
    { maxLength: 20 },
  )
  .map((parts) => parts.join(""));

describe("decoding entities (#132)", () => {
  test("decodes an apostrophe encoded twice, as some banks write it", () => {
    expect(decodeEntities("CB CAFE DE L&amp;apos;EXEMPLE")).toBe("CB CAFE DE L'EXEMPLE");
  });

  test("decodes an ampersand encoded twice, and an apostrophe encoded once", () => {
    expect(decodeEntities("PRLV ELEC &amp;amp; GAZ EXEMPLE")).toBe("PRLV ELEC & GAZ EXEMPLE");
    expect(decodeEntities("LIBRAIRIE L&apos;ENCRE EXEMPLE")).toBe("LIBRAIRIE L'ENCRE EXEMPLE");
  });

  test("decodes until no known entity is left, numeric ones and any case included", () => {
    expect(decodeEntities("A&amp;amp;amp;lt;B")).toBe("A<B");
    expect(decodeEntities("L&amp;#39;EST L&AMP;#x27;OUEST")).toBe("L'EST L'OUEST");
    // An entity may close on a character another one gives.
    expect(decodeEntities("&lt&#59; &#38;apos;")).toBe("< '");
  });

  test("leaves what names no entity as it is, once what encodes it is decoded", () => {
    expect(decodeEntities("R&D & CO")).toBe("R&D & CO");
    expect(decodeEntities("&amp;unknown; &#99999999; &#x;")).toBe("&unknown; &#99999999; &#x;");
  });

  test("leaves text without an entity untouched", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (text) => {
        fc.pre(!text.includes("&"));
        expect(decodeEntities(text)).toBe(text);
      }),
    );
  });

  test("gives back text escaped once or twice, when that text holds no entity itself", () => {
    fc.assert(
      fc.property(fc.oneof(entityLike, fc.string({ unit: "grapheme" })), (text) => {
        fc.pre(decodeEntities(text) === text);
        expect(decodeEntities(escapeXml(text))).toBe(text);
        expect(decodeEntities(escapeXml(escapeXml(text)))).toBe(text);
      }),
    );
  });

  test("gives what decoding one level per pass gives, once a pass changes nothing", () => {
    const named = new Map([
      ["amp", "&"],
      ["lt", "<"],
      ["gt", ">"],
      ["quot", '"'],
      ["apos", "'"],
      ["nbsp", String.fromCodePoint(0xa0)],
    ]);

    const onePass = (text: string) =>
      text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
        if (!name.startsWith("#")) {
          return named.get(name.toLowerCase()) ?? entity;
        }

        const hexadecimal = name.startsWith("#x") || name.startsWith("#X");
        const code = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);

        return code <= 0x10_ff_ff ? String.fromCodePoint(code) : entity;
      });

    const passByPass = (text: string): string => {
      const next = onePass(text);

      return next === text ? text : passByPass(next);
    };

    fc.assert(
      fc.property(entityLike, (text) => {
        expect(decodeEntities(text)).toBe(passByPass(text));
      }),
      { numRuns: 2000 },
    );
  });

  test("is idempotent: what it gives holds no entity left to decode", () => {
    fc.assert(
      fc.property(entityLike, (text) => {
        const decoded = decodeEntities(text);

        expect(decodeEntities(decoded)).toBe(decoded);
      }),
    );
  });

  test("decodes a crafted run of nested entities in linear time", () => {
    // Decoding one level per pass would take a million passes over five megabytes.
    expect(decodeEntities(`&${"amp;".repeat(1_000_000)}apos;`)).toBe("'");
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
