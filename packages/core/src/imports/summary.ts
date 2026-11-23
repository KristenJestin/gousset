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
