// What a receipt may be (#217): its type read from its first bytes, and the limits an installation
// sets. Pure, and free of Node's modules, so that a page can import it (`@gousset/core/attachments`)
// to refuse a file before sending it, as the server refuses it again.

/** The kinds of file a receipt may be, as an installation names them (`RECEIPT_TYPES`). */
export const RECEIPT_TYPES = ["pdf", "jpeg", "png", "heic"] as const;

export type ReceiptType = (typeof RECEIPT_TYPES)[number];

/** Each kind's media type, as the database keeps it and a download says it. */
export const MEDIA_TYPES = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
} as const satisfies { readonly [Type in ReceiptType]: string };

export type ReceiptMediaType = (typeof MEDIA_TYPES)[ReceiptType];

/** Each kind's name, as a refusal lists them: "PDF, JPEG, PNG and HEIC". */
export const TYPE_NAMES = {
  pdf: "PDF",
  jpeg: "JPEG",
  png: "PNG",
  heic: "HEIC",
} as const satisfies { readonly [Type in ReceiptType]: string };

/** A megabyte, as the limit counts it and a file manager shows it: a million bytes. */
export const MEGABYTE = 1_000_000;

/** The size a receipt may have when the installation says nothing (`RECEIPT_MAX_MB`). */
export const DEFAULT_MAX_MEGABYTES = 50;

/** What an installation takes as a receipt. */
export type ReceiptLimits = {
  /** In bytes. */
  readonly maxBytes: number;
  /** In the order `RECEIPT_TYPES` gives them. */
  readonly types: ReadonlyArray<ReceiptType>;
};

/** The limits when the installation sets none: 50 MB, and every kind. */
export const DEFAULT_RECEIPT_LIMITS: ReceiptLimits = {
  maxBytes: DEFAULT_MAX_MEGABYTES * MEGABYTE,
  types: RECEIPT_TYPES,
};

/** How many first bytes the type is read from. */
export const SNIFF_BYTES = 64;

const startsWith = (bytes: Uint8Array, prefix: Uint8Array, at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte);

const ascii = (text: string) => new TextEncoder().encode(text);

const PDF = ascii("%PDF-");
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff);
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const FTYP = ascii("ftyp");

/** The brands of HEIF holding HEVC images: what a phone's camera writes. */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);

/** HEIF's own brands, which AVIF files carry too: HEIC only when no AVIF brand comes with them. */
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** An ISO media file's brands (`ftyp`: its major brand, then its compatible ones), within `bytes`. */
function brandsOf(bytes: Uint8Array): ReadonlyArray<string> {
  if (!startsWith(bytes, FTYP, 4)) {
    return [];
  }

  // The box's size, big-endian, its own eight bytes of header included.
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const end = Math.min(bytes.length, boxSize);
  const brand = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const brands: Array<string> = [];

  if (end >= 12) {
    brands.push(brand(8));
  }

  // Past the major brand comes its version (4 bytes), then the compatible brands.
  for (let at = 16; at + 4 <= end; at += 4) {
    brands.push(brand(at));
  }

  return brands;
}

function isHeic(bytes: Uint8Array): boolean {
  const brands = brandsOf(bytes);

  if (brands.some((brand) => HEIC_BRANDS.has(brand))) {
    return true;
  }

  return (
    brands.some((brand) => HEIF_BRANDS.has(brand)) &&
    !brands.some((brand) => AVIF_BRANDS.has(brand))
  );
}

/**
 * The kind of file `head` (its first bytes, `SNIFF_BYTES` are enough) starts, whatever its name or
 * the browser says: a PDF's `%PDF-`, JPEG's and PNG's signatures, a HEIC's `ftyp` box. `undefined`
 * for anything else.
 */
export function sniffReceiptType(head: Uint8Array): ReceiptType | undefined {
  if (startsWith(head, PDF)) {
    return "pdf";
  }

  if (startsWith(head, JPEG)) {
    return "jpeg";
  }

  if (startsWith(head, PNG)) {
    return "png";
  }

  return isHeic(head) ? "heic" : undefined;
}

const isReceiptType = (name: string): name is ReceiptType =>
  RECEIPT_TYPES.some((type) => type === name);

/** The installation's settings, as its environment gives them: each may be left unset. */
export type ReceiptSettings = {
  /** A whole number of megabytes, from 1. */
  readonly maxMegabytes: number | undefined;
  /** Kinds separated by commas, as `pdf,jpeg`, in any case. */
  readonly types: string | undefined;
};

/**
 * The limits an installation's settings give, each one's default where it is unset; or the words
 * of `RECEIPT_TYPES` that name no kind Gousset can tell from a file's bytes.
 */
export function receiptLimitsOf(
  settings: ReceiptSettings,
): { readonly limits: ReceiptLimits } | { readonly unknownTypes: ReadonlyArray<string> } {
  const words = (settings.types ?? "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");

  const unknownTypes = words.filter((word) => !isReceiptType(word));

  if (unknownTypes.length > 0) {
    return { unknownTypes };
  }

  return {
    limits: {
      maxBytes: (settings.maxMegabytes ?? DEFAULT_MAX_MEGABYTES) * MEGABYTE,
      types:
        words.length === 0 ? RECEIPT_TYPES : RECEIPT_TYPES.filter((type) => words.includes(type)),
    },
  };
}

/** A size in megabytes, as a refusal says it: rounded up to a tenth, the tenth left out when 0. */
export function megabytes(bytes: number): number {
  return Math.ceil((bytes / MEGABYTE) * 10) / 10;
}
