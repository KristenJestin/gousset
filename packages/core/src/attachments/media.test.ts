import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_RECEIPT_LIMITS,
  MEGABYTE,
  RECEIPT_TYPES,
  megabytes,
  receiptLimitsOf,
  sniffReceiptType,
} from "./media";

const bytes = (...values: ReadonlyArray<number>) => Uint8Array.from(values);

const ascii = (text: string) => new TextEncoder().encode(text);

/** An ISO media file's `ftyp` box: its size, its major brand, a version, its compatible brands. */
function ftyp(major: string, compatible: ReadonlyArray<string>): Uint8Array {
  const size = 16 + compatible.length * 4;
  const box = new Uint8Array(size + 8);

  new DataView(box.buffer).setUint32(0, size);
  box.set(ascii("ftyp"), 4);
  box.set(ascii(major), 8);
  compatible.forEach((brand, index) => box.set(ascii(brand), 16 + index * 4));

  return box;
}

const PDF = ascii("%PDF-1.7\n%made up receipt");
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);

describe("a receipt's type, read from its first bytes", () => {
  test("a PDF, a JPEG and a PNG are known by their signatures", () => {
    expect(sniffReceiptType(PDF)).toBe("pdf");
    expect(sniffReceiptType(JPEG)).toBe("jpeg");
    expect(sniffReceiptType(PNG)).toBe("png");
  });

  test("a phone's HEIC photo is known by its brands", () => {
    expect(sniffReceiptType(ftyp("heic", ["mif1", "heic"]))).toBe("heic");
    expect(sniffReceiptType(ftyp("mif1", ["heic"]))).toBe("heic");
    expect(sniffReceiptType(ftyp("heix", []))).toBe("heic");
    expect(sniffReceiptType(ftyp("mif1", ["miaf"]))).toBe("heic");
  });

  test("an AVIF image, an MP4 video or a QuickTime film is no HEIC", () => {
    expect(sniffReceiptType(ftyp("avif", ["mif1", "miaf"]))).toBeUndefined();
    expect(sniffReceiptType(ftyp("mif1", ["avif"]))).toBeUndefined();
    expect(sniffReceiptType(ftyp("isom", ["iso2", "mp41"]))).toBeUndefined();
    expect(sniffReceiptType(ftyp("qt  ", ["qt  "]))).toBeUndefined();
  });

  test("a name or a text says nothing: a file renamed receipt.pdf is still what its bytes are", () => {
    expect(sniffReceiptType(ascii("receipt.pdf"))).toBeUndefined();
    expect(sniffReceiptType(ascii("<html><body>%PDF-</body></html>"))).toBeUndefined();
    expect(sniffReceiptType(ascii("GIF89a"))).toBeUndefined();
    expect(sniffReceiptType(new Uint8Array())).toBeUndefined();
  });

  test("a signature cut short is no type", () => {
    expect(sniffReceiptType(PDF.subarray(0, 4))).toBeUndefined();
    expect(sniffReceiptType(JPEG.subarray(0, 2))).toBeUndefined();
    expect(sniffReceiptType(PNG.subarray(0, 7))).toBeUndefined();
    expect(sniffReceiptType(ftyp("heic", []).subarray(0, 8))).toBeUndefined();
  });

  test("whatever follows a signature, the type is the signature's", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { head: PDF.subarray(0, 5), type: "pdf" },
          { head: JPEG.subarray(0, 3), type: "jpeg" },
          { head: PNG.subarray(0, 8), type: "png" },
        ),
        fc.uint8Array({ maxLength: 128 }),
        ({ head, type }, rest) => {
          const file = new Uint8Array(head.length + rest.length);

          file.set(head);
          file.set(rest, head.length);

          expect(sniffReceiptType(file)).toBe(type);
        },
      ),
    );
  });

  test("bytes that start with no signature are never taken for one", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 128 }), (file) => {
        const type = sniffReceiptType(file);
        const starts = (prefix: Uint8Array) => prefix.every((byte, index) => file[index] === byte);

        if (type === "pdf") {
          expect(starts(ascii("%PDF-"))).toBe(true);
        }

        if (type === "jpeg") {
          expect(starts(bytes(0xff, 0xd8, 0xff))).toBe(true);
        }

        if (type === "png") {
          expect(starts(PNG.subarray(0, 8))).toBe(true);
        }

        if (type === "heic") {
          expect(file.subarray(4, 8)).toEqual(ascii("ftyp"));
        }
      }),
    );
  });
});

describe("the limits an installation sets", () => {
  test("unset, a receipt is 50 MB at most, of every kind", () => {
    expect(receiptLimitsOf({ maxMegabytes: undefined, types: undefined })).toEqual({
      limits: DEFAULT_RECEIPT_LIMITS,
    });
    expect(DEFAULT_RECEIPT_LIMITS).toEqual({ maxBytes: 50 * MEGABYTE, types: RECEIPT_TYPES });
    expect(receiptLimitsOf({ maxMegabytes: undefined, types: " " })).toEqual({
      limits: DEFAULT_RECEIPT_LIMITS,
    });
  });

  test("a size and kinds given are taken, the kinds in Gousset's order, in any case", () => {
    expect(receiptLimitsOf({ maxMegabytes: 10, types: "PNG, pdf" })).toEqual({
      limits: { maxBytes: 10 * MEGABYTE, types: ["pdf", "png"] },
    });
  });

  test("a kind Gousset cannot read from a file's bytes is named, so that the app refuses to start", () => {
    expect(receiptLimitsOf({ maxMegabytes: undefined, types: "pdf,webp,GIF" })).toEqual({
      unknownTypes: ["webp", "gif"],
    });
  });

  test("any whole number of megabytes is that many millions of bytes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (size) => {
        const read = receiptLimitsOf({ maxMegabytes: size, types: undefined });

        expect(read).toEqual({ limits: { maxBytes: size * MEGABYTE, types: RECEIPT_TYPES } });
      }),
    );
  });
});

describe("a size, as a refusal says it", () => {
  test("in megabytes, rounded up to a tenth", () => {
    expect(megabytes(63 * MEGABYTE)).toBe(63);
    expect(megabytes(50 * MEGABYTE + 1)).toBe(50.1);
    expect(megabytes(62_345_678)).toBe(62.4);
  });

  test("a file over the limit never reads as within it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 10 * MEGABYTE }),
        (limit, over) => {
          expect(megabytes(limit * MEGABYTE + over)).toBeGreaterThan(limit);
        },
      ),
    );
  });
});
