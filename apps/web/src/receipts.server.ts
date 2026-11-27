import { receiptStorageLayer } from "@gousset/core";
import { RECEIPT_TYPES, receiptLimitsOf } from "@gousset/core/attachments";
import type { ReceiptLimits } from "@gousset/core/attachments";

import { ENV } from "./env.server";

// The receipts' settings (#217), as the installation started the app with them. The environment is
// passed whole: written `ENV.RECEIPT_MAX_MB`, a public variable is replaced by its build-time value
// (`security.ts` says the same), and every installation would keep the build's (#244, #245).

type ReceiptEnvironment = {
  readonly RECEIPTS_DIRECTORY?: string;
  readonly RECEIPT_MAX_MB?: number;
  readonly RECEIPT_TYPES?: string;
};

/** Where receipts are kept when the installation names no directory: beside the server. */
const DEFAULT_DIRECTORY = "receipts";

function receiptLimitsFrom(env: ReceiptEnvironment): ReceiptLimits {
  const read = receiptLimitsOf({ maxMegabytes: env.RECEIPT_MAX_MB, types: env.RECEIPT_TYPES });

  if ("unknownTypes" in read) {
    throw new Error(
      `RECEIPT_TYPES names ${read.unknownTypes.join(", ")}: a receipt may be ${RECEIPT_TYPES.join(", ")}, separated by commas.`,
    );
  }

  return read.limits;
}

function receiptsDirectoryFrom(env: ReceiptEnvironment): string {
  const directory = env.RECEIPTS_DIRECTORY?.trim() ?? "";

  return directory === "" ? DEFAULT_DIRECTORY : directory;
}

/** The size and the kinds a receipt may have: an unknown kind stops the app here, at its start. */
export const receiptLimits = receiptLimitsFrom(ENV);

/** The receipts' directory of this installation. */
export const receiptStorage = receiptStorageLayer(receiptsDirectoryFrom(ENV));
