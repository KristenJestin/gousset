import type { ImportFormat, ImportStep, ImportSummary } from "@gousset/core/imports";
import { m } from "@gousset/i18n/messages";

/** A format's name, as the screen writes it. */
export function formatName(format: ImportFormat): string {
  switch (format) {
    case "ofx":
      return m.importFormatOfx();
    case "qfx":
      return m.importFormatQfx();
    case "qif":
      return m.importFormatQif();
    case "camt053":
      return m.importFormatCamt053();
    case "mt940":
      return m.importFormatMt940();
    case "csv":
      return m.importFormatCsv();
  }
}

/** Each step of the import's job, in the screen's words. */
export const IMPORT_STEP_LABELS = {
  read: () => m.importStepRead(),
  deduplicate: () => m.importStepDeduplicate(),
  save: () => m.importStepSave(),
} satisfies { readonly [Step in ImportStep]: () => string };

/** Where an import stands, in a word or two. */
export function stateName(summary: ImportSummary): string {
  switch (summary.status) {
    case "queued":
      return m.importStateQueued();
    case "reading":
      return m.importStateReading();
    case "saving":
      return m.importStateSaving();
    case "waiting":
      return summary.waitingFor === "profile"
        ? m.importStateWaitingProfile()
        : m.importStateWaitingAccount();
    case "done":
      return m.importStateDone();
    case "failed":
      return m.importStateFailed();
    case "undone":
      return m.importStateUndone();
  }
}

/**
 * Why an import failed or was refused, by its code (a reader's error, the core's, the upload's):
 * what to do about it.
 */
export function importFailureMessage(code: string | null): string {
  switch (code) {
    case "NotAStatement":
    case "NEEDS_PROFILE":
      return m.importFailureNotAStatement();
    case "MalformedFile":
      return m.importFailureMalformed();
    case "MissingField":
    case "InvalidField":
      return m.importFailureField();
    case "UnsupportedContent":
      return m.importFailureUnsupported();
    case "CURRENCY_MISMATCH":
      return m.importFailureCurrency();
    case "FILE_TOO_LARGE":
      return m.importFailureTooLarge();
    case "EMPTY_FILE":
      return m.importFailureEmpty();
    case "UNKNOWN_FORMAT":
      return m.importFailureUnknownFormat();
    case "IMPORT_UNAVAILABLE":
    case "QUEUE_UNAVAILABLE":
      return m.importFailureUnavailable();
    default:
      return m.importFailureOther();
  }
}
