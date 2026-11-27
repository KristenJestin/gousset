import { TYPE_NAMES, megabytes } from "@gousset/core/attachments";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";

import type { ReceiptRefusal } from "../lib/receipts";
import { errorMessage } from "./messages";

/** "PDF, JPEG, PNG and HEIC", in the interface's language. */
function typesText(types: ReadonlyArray<keyof typeof TYPE_NAMES>): string {
  return new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(
    types.map((type) => TYPE_NAMES[type]),
  );
}

/** A size in megabytes, as the interface writes numbers: "63", "50.1" or "50,1". */
const megabytesText = (bytes: number) =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(megabytes(bytes));

/** Why a receipt was refused (`ReceiptRefusalCode`), naming the limit it passed. */
export function receiptRefusalMessage(refusal: ReceiptRefusal): string {
  switch (refusal.refused) {
    case "RECEIPT_TOO_LARGE": {
      const limit = megabytesText(refusal.limit ?? 0);

      return refusal.bytes === null || refusal.bytes === undefined
        ? m.receiptRefusalTooLargeUnsized({ limit })
        : m.receiptRefusalTooLarge({ size: megabytesText(refusal.bytes), limit });
    }

    case "RECEIPT_TYPE":
      return m.receiptRefusalType({ types: typesText(refusal.allowed ?? []) });
    case "RECEIPT_EMPTY":
      return m.receiptRefusalEmpty();
    case "LINE_NOT_FOUND":
      return m.receiptRefusalLineNotFound();
    case "SUBJECT_NOT_FOUND":
      return m.receiptRefusalSubjectNotFound();
    case "RECEIPT_NOT_FOUND":
      return m.receiptRefusalNotFound();
    case "RECEIPT_UNAVAILABLE":
      return m.receiptRefusalUnavailable();
    case "UPLOAD_FAILED":
      return m.receiptRefusalUploadFailed();
    case "SIGN_IN_REQUIRED":
    case "PASSWORD_CHANGE_REQUIRED":
      return errorMessage(refusal.refused);
  }
}
