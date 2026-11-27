import { createHash } from "node:crypto";

import type { OperationKind } from "../investments/positions";

// How an import of a broker's operations recognises an operation it already has (docs/data-model.md,
// v0.6, "The dedup key of an imported operation"): by its line's key, unique `(account_id,
// dedup_key)` as every line's (`./keys`). The prefixes `reference:` and `operation:` are its own, so
// that an operation never collides with a cash line read from a bank's statement of the same account
// (`bank:`, `content:`).

/** What an operation's key is made of: its row as read, its quantities as Postgres writes them. */
export type KeyedOperation = {
  readonly bookedOn: string;
  readonly kind: OperationKind;
  readonly isin: string | null;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly amountMinor: number;
  /** The broker's reference for the row, when the file gives one. */
  readonly reference: string | null;
  /** Whether the broker's layout makes that reference unique to the row. */
  readonly referenceUnique: boolean;
};

const REFERENCE = "reference:";
const OPERATION = "operation:";

function contentOf(operation: KeyedOperation): string {
  return createHash("sha256")
    .update(
      [
        operation.bookedOn,
        operation.kind,
        operation.isin ?? "",
        operation.quantity ?? "",
        operation.unitPrice ?? "",
        String(operation.amountMinor),
      ].join("\n"),
    )
    .digest("hex");
}

/**
 * Each operation's dedup key, in the file's order: `reference:` and the broker's reference where
 * the layout makes it unique and the row has one; otherwise `operation:`, the SHA-256 of its day, kind,
 * ISIN, quantity, unit price and amount, and the occurrence of that sextuple in the file, so that
 * two identical purchases of a day are `…#1` and `…#2` and stay two. Computed over the whole file
 * at once: a file saved in chunks counts its occurrences across them.
 */
export function operationDedupKeys(operations: ReadonlyArray<KeyedOperation>): Array<string> {
  const occurrences = new Map<string, number>();

  return operations.map((operation) => {
    if (operation.referenceUnique && operation.reference !== null && operation.reference !== "") {
      return `${REFERENCE}${operation.reference}`;
    }

    const content = contentOf(operation);
    const occurrence = (occurrences.get(content) ?? 0) + 1;

    occurrences.set(content, occurrence);

    return `${OPERATION}${content}#${String(occurrence)}`;
  });
}
