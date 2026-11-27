import { crc32, deflateSync } from "node:zlib";

// Pictures made here, for a logo to upload (#204): never a real brand's, never read from a file.

/** One PNG chunk: its length, its type, its data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);

  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");

  const tail = Buffer.alloc(4);

  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);

  return Buffer.concat([head, data, tail]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A PNG a browser draws: `size` × `size` pixels of one colour (8-bit RGB, no filter). `padding`
 * bytes of a private chunk after the pixels make it as large as a test needs, still a PNG.
 */
export function solidPng(size: number, [red, green, blue]: [number, number, number], padding = 0) {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  // Bit depth 8, colour type 2 (RGB), deflate, filter 0, no interlace.
  header.set([8, 2, 0, 0, 0], 8);

  const row = Buffer.alloc(1 + size * 3);

  for (let pixel = 0; pixel < size; pixel += 1) {
    row.set([red, green, blue], 1 + pixel * 3);
  }

  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  const chunks = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(pixels))];

  if (padding > 0) {
    chunks.push(chunk("puNk", Buffer.alloc(padding)));
  }

  chunks.push(chunk("IEND", new Uint8Array()));

  return Buffer.concat(chunks);
}

/** A PNG of exactly `bytes` bytes, for a size limit: a small picture padded out. */
export function pngOfSize(bytes: number) {
  const bare = solidPng(4, [40, 110, 80]);
  // The private chunk adds its own 12 bytes of length, type and CRC.
  const padded = solidPng(4, [40, 110, 80], bytes - bare.length - 12);

  if (padded.length !== bytes) {
    throw new Error(`A PNG of ${String(bytes)} bytes was asked, ${String(padded.length)} made`);
  }

  return padded;
}
