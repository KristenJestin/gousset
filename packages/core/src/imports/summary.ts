import type { CsvDefinition, OperationKind } from "@gousset/import";

// An import as the screen and the MCP door read it. Types and constants only, with no server
// code: the browser imports this module (`@gousset/core/imports`).

/** The formats an import reads: the values of the database's `import_format`. */
export type ImportFormat = "ofx" | "qfx" | "qif" | "camt053" | "mt940" | "csv";

/** Where an import stands: the values of the database's `import_status`. */
export type ImportStatus =
  | "queued"
  | "reading"
  | "waiting"
  | "saving"
  | "done"
  | "failed"
  | "undone";

/** The import's steps, in order: the job reports each, and the screen moves through them. */
export const IMPORT_STEPS = ["read", "deduplicate", "save"] as const;

export type ImportStep = (typeof IMPORT_STEPS)[number];

/** The largest file an import takes: a statement is a few hundred kilobytes. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** One file dropped, from upload to summary. Days are `YYYY-MM-DD`, instants ISO 8601. */
export type ImportSummary = {
  readonly id: string;
  readonly fileName: string;
  readonly format: ImportFormat;
  readonly status: ImportStatus;
  /** What a waiting import waits for: the user to choose its account, or how to read its CSV. */
  readonly waitingFor: "account" | "profile" | null;
  readonly account: { readonly id: string; readonly name: string } | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly linesRead: number;
  readonly linesAdded: number;
  readonly linesDuplicate: number;
  readonly linesHeld: number;
  /**
   * What the file holds: an account's lines, or a broker's operations (v0.6), whose counts above
   * count operations. Operations once its profile reads them or its lines are operations' cash.
   */
  readonly reads: "statement" | "operations";
  /**
   * The file stated a balance of zero that the account's lines contradict on its day: it looked
   * empty and was not recorded, so the account is not checked against it (#130).
   */
  readonly balanceIgnored: boolean;
  /**
   * Why it failed, as a code: a reader's error (`MalformedFile`), `CURRENCY_MISMATCH`,
   * `NOT_AN_INVESTMENT_ACCOUNT` (a broker's operations dropped on another account), an operation
   * refused (`OperationRefused`, `InvalidIsin`, `InvalidQuantity`)…
   */
  readonly errorCode: string | null;
  /** The job that runs it, for the screen to follow. */
  readonly jobId: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly undoneAt: string | null;
};

/**
 * The most profiles a user keeps: the import tries each on every CSV file it reads, beside the
 * shipped ones, so their number bounds what an upload costs.
 */
export const MAX_PROFILES = 50;

/** The longest name or institution a profile takes, in characters. */
export const MAX_PROFILE_NAME = 100;

/** The longest header a profile keeps, normalised, in characters: a thousand columns at most. */
export const MAX_PROFILE_HEADER = 10_000;

/** The longest profile file taken to share a profile, in characters: one is under a kibibyte. */
export const MAX_PROFILE_FILE = 64 * 1024;

/** A profile chosen to read a CSV file: one of the user's, by id, or one shipped, by key. */
export type ProfileChoice =
  | { readonly kind: "stored"; readonly id: string }
  | { readonly kind: "shipped"; readonly key: string };

/**
 * An import profile, the user's own or one shipped with Gousset, as the screen lists it. `header` is
 * the normalised header row of the files it recognises (`normalizeHeader`), `null` for a profile
 * that recognises none (made from a file without a header, or imported from a file).
 */
export type ImportProfileEntry =
  | {
      readonly source: "stored";
      readonly id: string;
      readonly name: string;
      readonly institution: string | null;
      readonly kind: "statement" | "operations";
      readonly header: string | null;
      /** `null` when the stored definition no longer reads: the profile must be saved again. */
      readonly definition: CsvDefinition | null;
    }
  | {
      readonly source: "shipped";
      readonly key: string;
      readonly name: string;
      readonly institution: null;
      readonly kind: "statement" | "operations";
      readonly header: string;
      readonly definition: CsvDefinition;
    };

/** A profile to save: its name, the institution it reads or `null`, how it reads, its header. */
export type ProfileDraft = {
  readonly name: string;
  readonly institution: string | null;
  /** A statement's or a broker's operations': the profile's kind follows it. */
  readonly definition: CsvDefinition;
  /** The header of the file it was made on, normalised, so that the next one is recognised. */
  readonly header: string | null;
};

/** A profile as a file, to share it: the definition's JSON, under a name to save it as. */
export type ProfileFile = { readonly fileName: string; readonly content: string };

/** How a profile reads a CSV import's file: its header is the file's, or a test read passed. */
export type ProfileFit = {
  readonly profile: ImportProfileEntry;
  readonly by: "header" | "test-read";
};

/** The profiles that read a CSV import's file, and the one its import used. */
export type ProfilesForImport = {
  readonly fileName: string;
  readonly status: ImportStatus;
  /**
   * The profile the import read its file with, as its row records it: `null` when none did yet,
   * detection read it, a definition was given by hand, or the profile was deleted since (or its
   * key is no longer shipped): a done import with none may have used any of these.
   */
  readonly used: ImportProfileEntry | null;
  /**
   * Those whose header is the file's, then those whose test read passes; within each, in the order
   * an upload tries them: the user's, the most recently updated first, then the shipped ones. The
   * first matched by its header is the one an upload of this file would read it with.
   */
  readonly fitting: ReadonlyArray<ProfileFit>;
};

/** A line of a test read, as the import would save it: its day, its label, its amount. */
export type CsvTestLine = {
  /** Its place among the lines read, counted from 1. */
  readonly position: number;
  readonly bookedOn: string;
  readonly label: string;
  /** In the minor units of the preview's `currency`. */
  readonly amountMinor: number;
  /** A broker's operation's kind; `null` for a statement's line. */
  readonly kind: OperationKind | null;
};

/**
 * Why a test read refused the file, as the reader says it: its error's tag, the file's line and
 * column where there is one, the field at fault and the text written there.
 */
export type CsvReadRefusal = {
  readonly error:
    | "NotAStatement"
    | "MalformedFile"
    | "MissingField"
    | "InvalidField"
    | "UnsupportedContent"
    | "InvalidOption";
  readonly line: number | null;
  readonly column: number | null;
  readonly field: string | null;
  readonly text: string | null;
};

/** The most lines of a test read the preview shows. */
export const TEST_READ_SHOWN = 10;

/**
 * A CSV import's file read with a profile on the import screen, before it is imported: its first
 * rows as the profile splits them, the header it would be recognised by, and a test read of its top.
 */
export type CsvPreview = {
  /** The header and the first rows, each value as written; none when the file cannot be split. */
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  /** The header row as a profile keeps it (`normalizeHeader`); `null` when the profile reads none. */
  readonly header: string | null;
  /** The account's currency the amounts are read in; `null` before an account is chosen (`CLF`). */
  readonly currency: string | null;
  /** The first lines read (`TEST_READ_SHOWN` at most), or why the file is refused. */
  readonly read:
    | { readonly lines: ReadonlyArray<CsvTestLine> }
    | { readonly refused: CsvReadRefusal };
};
