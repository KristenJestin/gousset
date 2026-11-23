import type { CsvProfile } from "@gousset/import";

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
  /** Why it failed, as a code: a reader's error (`MalformedFile`), `CURRENCY_MISMATCH`… */
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
      readonly definition: CsvProfile | null;
    }
  | {
      readonly source: "shipped";
      readonly key: string;
      readonly name: string;
      readonly institution: null;
      readonly kind: "statement";
      readonly header: string;
      readonly definition: CsvProfile;
    };

/** A profile to save: its name, the institution it reads or `null`, how it reads, its header. */
export type ProfileDraft = {
  readonly name: string;
  readonly institution: string | null;
  readonly definition: CsvProfile;
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
