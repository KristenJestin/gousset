import {
  csvSamples,
  exampleStatement,
  statementFormats,
  statementSamples,
  writeStatement,
} from "@gousset/fixture";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { detectFormat } from "./format";
import type { StatementFormat } from "./format";

const utf8 = new TextEncoder();

/** The format each sample of the fixture is written in. */
const SAMPLE_FORMATS = {
  ofxXml: "ofx",
  ofxSgmlWindows1252: "ofx",
  ofxSgmlDates: "ofx",
  ofxUnsigned: "ofx",
  ofxUnsignedNoDebit: "ofx",
  qfxCreditCard: "qfx",
  ofxDoubleEncoded: "ofx",
  qifDayFirst: "qif",
  qifQuicken: "qif",
  qifWindows1252: "qif",
  qifDotDates: "qif",
  camt053Version08: "camt053",
  camt053Version02: "camt053",
  camt053Batch: "camt053",
  camt053Daily: "camt053",
  camt053DoubleEncoded: "camt053",
  mt940Plain: "mt940",
  mt940SwiftBlocks: "mt940",
  mt940Structured: "mt940",
  mt940MultiStatement: "mt940",
} satisfies { [name in keyof typeof statementSamples]: StatementFormat };

describe("detecting a statement file's format", () => {
  test("detects every sample of the fixture as its own format", () => {
    for (const [name, sample] of Object.entries(statementSamples)) {
      const expected = Object.entries(SAMPLE_FORMATS).find(([key]) => key === name)?.[1];

      expect([name, detectFormat(sample.bytes, sample.fileName)]).toEqual([name, expected]);
    }
  });

  test("detects every CSV sample as CSV", () => {
    for (const [name, sample] of Object.entries(csvSamples)) {
      expect([name, detectFormat(sample.bytes, sample.fileName)]).toEqual([name, "csv"]);
    }
  });

  test("detects what each of the fixture's writers writes as its format", () => {
    for (const format of statementFormats) {
      const file = writeStatement(format, exampleStatement);

      expect([format, detectFormat(utf8.encode(file.contents), file.fileName)]).toEqual([
        format,
        format,
      ]);
    }
  });

  test("detects an OFX file named .qfx as QFX", () => {
    const sample = statementSamples.ofxXml;

    expect(detectFormat(sample.bytes, "statement.QFX")).toBe("qfx");
    expect(detectFormat(sample.bytes, "statement.ofx")).toBe("ofx");
  });

  test("detects CSV by its extension or a separator on its first line", () => {
    expect(detectFormat(utf8.encode("Some export\nof lines\n"), "export.txt")).toBe("csv");
    expect(detectFormat(utf8.encode("date|label|amount\n"), "export")).toBe("csv");
  });

  test("detects nothing in an empty file, an image or plain text", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

    expect(detectFormat(new Uint8Array(), "statement.ofx")).toBeNull();
    expect(detectFormat(png, "photo.png")).toBeNull();
    expect(detectFormat(utf8.encode("Dear bank\nplease find enclosed\n"), "letter.md")).toBeNull();
  });

  test("never throws, whatever the bytes and the name", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 6000 }), fc.string(), (bytes, fileName) => {
        const format = detectFormat(bytes, fileName);

        expect(
          format === null || ["ofx", "qfx", "qif", "camt053", "mt940", "csv"].includes(format),
        ).toBe(true);
      }),
    );
  });
});
