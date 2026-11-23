import { createHash } from "node:crypto";

// How an import recognises a line it already has (docs/data-model.md, "Imports and
// deduplication"): each line read gets a dedup key, and the unique key `(account_id, dedup_key)`
// decides what is added. A line with no exact match may still be the same payment read another way:
// a near duplicate, set aside for review.

import type { ImportFormat } from "./summary";

export type { ImportFormat } from "./summary";

/** What a key is made of: a line as a reader gives it. */
export type KeyedLine = {
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly label: string;
  readonly bankId: string | null;
};

/**
 * The formats whose bank id is unique within the account: OFX's and QFX's `FITID`, CAMT.053's
 * `AcctSvcrRef`. QIF's `N` and MT940's references (often `NONREF`) are not.
 */
const UNIQUE_BANK_IDS: ReadonlySet<ImportFormat> = new Set(["ofx", "qfx", "camt053"]);

const BANK = "bank:";
const CONTENT = "content:";

/** A label as the content key reads it: trimmed, inner spaces collapsed. */
export function keyLabel(label: string): string {
  return label.trim().replaceAll(/\s+/g, " ");
}

function contentOf(line: KeyedLine): string {
  return createHash("sha256")
    .update(`${line.bookedOn}\n${String(line.amountMinor)}\n${keyLabel(line.label)}`)
    .digest("hex");
}

/**
 * Each line's dedup key, in the file's order: `bank:` and the bank's id where the format makes it
 * unique and the line has one; otherwise `content:`, the SHA-256 of the booking date, the amount
 * and the label, and the occurrence of that triple in the file, so that two identical coffees of
 * one day are `…#1` and `…#2` and stay two.
 */
export function dedupKeys(format: ImportFormat, lines: ReadonlyArray<KeyedLine>): Array<string> {
  const occurrences = new Map<string, number>();

  return lines.map((line) => {
    if (UNIQUE_BANK_IDS.has(format) && line.bankId !== null && line.bankId !== "") {
      return `${BANK}${line.bankId}`;
    }

    const content = contentOf(line);
    const occurrence = (occurrences.get(content) ?? 0) + 1;

    occurrences.set(content, occurrence);

    return `${CONTENT}${content}#${String(occurrence)}`;
  });
}

/** A content key without its occurrence: the date, amount and label it was made of. */
function tripleOf(key: string): string {
  return key.slice(0, key.lastIndexOf("#"));
}

/**
 * Whether two keys already say the lines are two: two bank ids that differ, or the same date,
 * amount and label with another occurrence (the second coffee of the day, counted on purpose). A
 * line entered by hand has no key and tells nothing apart.
 */
export function keysTellApart(a: string | null, b: string | null): boolean {
  if (a === null || b === null || a === b) {
    return false;
  }

  if (a.startsWith(BANK) && b.startsWith(BANK)) {
    return true;
  }

  return a.startsWith(CONTENT) && b.startsWith(CONTENT) && tripleOf(a) === tripleOf(b);
}

/** A label's trigrams, as pg_trgm makes them: each word, lower case and without accents, padded. */
function trigrams(label: string): ReadonlySet<string> {
  const words = label
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");

  const grams = new Set<string>();

  for (const word of words) {
    const padded = `  ${word} `;

    for (let start = 0; start + 3 <= padded.length; start += 1) {
      grams.add(padded.slice(start, start + 3));
    }
  }

  return grams;
}

/**
 * How alike two labels are, from 0 to 1: the trigrams they share over all their trigrams. Two
 * labels with no word at all are alike.
 */
export function labelSimilarity(a: string, b: string): number {
  const first = trigrams(a);
  const second = trigrams(b);

  if (first.size === 0 && second.size === 0) {
    return 1;
  }

  let shared = 0;

  for (const gram of first) {
    if (second.has(gram)) {
      shared += 1;
    }
  }

  return shared / (first.size + second.size - shared);
}

/** How many days apart a near duplicate's booking date may be. */
export const NEAR_DAYS = 3;

/** How alike its label must be (`labelSimilarity`). */
export const ALIKE_LABELS = 0.4;

/** A line the account already has, from another import or entered by hand. */
export type ExistingLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly label: string;
  /** `null` for a line entered by hand. */
  readonly dedupKey: string | null;
};

/** A line read, with the key that found no exact match. */
export type ReadLine = {
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly label: string;
  readonly dedupKey: string;
};

const DAY_MS = 86_400_000;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * The read lines that are near duplicates of a line the account already has: the same amount, a
 * booking date at most `NEAR_DAYS` apart and a label alike, unless their keys already tell them
 * apart. By the index of the read line, the id of the line it looks like: the most alike, then the
 * closest. A known line is the near duplicate of one read line at most.
 */
export function nearDuplicates(
  read: ReadonlyArray<ReadLine>,
  existing: ReadonlyArray<ExistingLine>,
): Map<number, string> {
  const taken = new Set<string>();
  const found = new Map<number, string>();

  for (const [index, line] of read.entries()) {
    let best: { id: string; similarity: number; days: number } | undefined;

    for (const known of existing) {
      if (taken.has(known.id) || known.amountMinor !== line.amountMinor) {
        continue;
      }

      const days = daysApart(known.bookedOn, line.bookedOn);

      if (days > NEAR_DAYS || keysTellApart(known.dedupKey, line.dedupKey)) {
        continue;
      }

      const similarity = labelSimilarity(known.label, line.label);

      if (similarity < ALIKE_LABELS) {
        continue;
      }

      if (
        best === undefined ||
        similarity > best.similarity ||
        (similarity === best.similarity && days < best.days)
      ) {
        best = { id: known.id, similarity, days };
      }
    }

    if (best !== undefined) {
      taken.add(best.id);
      found.set(index, best.id);
    }
  }

  return found;
}
