import {
  IMPORT_STEPS,
  ImportProfiles,
  Imports,
  MAX_PENDING_UPLOADS,
  MAX_UPLOAD_PARTS,
  UPLOAD_MINUTES,
} from "@gousset/core";
import type {
  CreatedUpload,
  FileUploadStatus,
  ImportAccount,
  ImportFormat,
  ImportPage,
  ImportProfileEntry,
  ImportSummary,
  ProfilesForImport,
  Started,
  Undone,
} from "@gousset/core";
import { Duration, Effect, Exit, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import type { Caller } from "../tool";

const FORMATS = ["ofx", "qfx", "qif", "camt053", "mt940", "csv"] as const;

const ImportsInput = Schema.Struct({
  action: Schema.Literals([
    "upload",
    "create_upload",
    "status",
    "list",
    "undo",
    "profiles",
  ]).annotate({
    description:
      "upload: import a statement file. create_upload: an address to send a large file to from a shell, before upload. status: where one import or file upload stands. list: the imports, newest first. undo: remove what one import added. profiles: the CSV import profiles, or those that read one import's file.",
  }),
  file_name: Schema.optional(
    Schema.String.annotate({
      description: "upload: the file's name, with its extension (statement-2026-10.ofx).",
    }),
  ),
  content: Schema.optional(
    Schema.String.annotate({ description: "upload: the file's text, whole, as it is." }),
  ),
  content_base64: Schema.optional(
    Schema.String.annotate({
      description:
        "upload, instead of content: the file's bytes in base64, for a file not in UTF-8.",
    }),
  ),
  file_upload: Schema.optional(
    Schema.String.annotate({
      description:
        "upload, instead of content: the id create_upload gave, once the file was sent to its address. status: that id, to see whether the file arrived.",
    }),
  ),
  size: Schema.optional(
    Schema.Int.annotate({
      description: "create_upload: the file's exact size in bytes (wc -c < statement.ofx).",
    }),
  ),
  parts: Schema.optional(
    Schema.Int.annotate({
      description: `create_upload: how many parts the file is sent in, 1 by default, ${MAX_UPLOAD_PARTS} at most: more than one only when a proxy refuses a request that large.`,
    }),
  ),
  format: Schema.optional(
    Schema.Literals(FORMATS).annotate({
      description:
        "upload, create_upload: the file's format, when its name and content do not tell it.",
    }),
  ),
  account: Schema.optional(
    Schema.String.annotate({
      description: "upload, create_upload: the account's name, as the user calls it (any case).",
    }),
  ),
  import: Schema.optional(
    Schema.String.annotate({
      description:
        "status, undo: the import's id, as upload and list give it. profiles: a CSV import's id, to see which profiles read its file.",
    }),
  ),
  before: Schema.optional(
    Schema.String.annotate({
      description: "list: an import's id, to list the older ones, as a list's last line writes it.",
    }),
  ),
});

type ImportsInput = typeof ImportsInput.Type;

const DESCRIPTION = `Imports bank statement files into the user's accounts, without duplicates, and lists, follows and undoes imports. Use it when the user gives a statement file (OFX, QFX, QIF, CAMT.053, MT940, CSV) or asks what was imported.

A file you can reach from a shell, larger than a few tens of kilobytes, goes through a file upload, so that its bytes never pass through the conversation: {"action":"create_upload","file_name":"2024-2026.ofx","size":1048576} (its exact size in bytes), then, from that shell, curl -sS -F 'file=@2024-2026.ofx' <the address it gave>, then {"action":"upload","file_upload":"<the id it gave>"}. A smaller file goes in the call itself: {"action":"upload","file_name":"october.ofx","content":"OFXHEADER:100..."}

Refused: an empty file, a file over 10 MB (through content, a request carries 4 MB at most, about 3 MB of file in base64: send a larger one through create_upload), a format not recognised, an account name matching none or several of the user's accounts (the refusal names them), more than ${MAX_PENDING_UPLOADS} file uploads waiting, a file upload used, expired or not received whole, an import id the user does not have, and undoing an import still running. A CSV file's columns are confirmed on Gousset's import screen. Writes need a connection allowed to read and write.

Actions:
- upload (writes): imports one file. Give file_name and exactly one of content (the file's text) or content_base64 (its bytes, for a file not in UTF-8); or file_upload alone, for a file sent to a file upload. The format is told from the file; name it with format when it is not. The account is recognised from the file (IBAN, number); name it with account, the user's name for it, when the file does not say it (QIF and CSV never do). It waits up to 15 seconds and answers the summary: lines read, added, already known (duplicates, never added twice) and held for review as near duplicates. A file imported before adds nothing again, and the answer says so.
- create_upload (writes): for a file you can reach from a shell, larger than a few tens of kilobytes: its bytes then never pass through the conversation. Give file_name and size (its exact size in bytes), and account or format when needed. It answers a file upload's id and its address, secret and valid ${UPLOAD_MINUTES} minutes. Send the file from your shell, as it is: curl -sS -F 'file=@statement.ofx' <address>. Then call upload with file_upload. A proxy refusing so large a request: declare parts (2 to ${MAX_UPLOAD_PARTS}) and send each part in order, with its number (-F part=1). A file upload is imported once, by this connection only, then deleted; unused, it expires.
- status (reads): one import's state, step and counts; or, with file_upload, whether the file upload is pending, uploaded or expired.
- list (reads): the imports, newest first, 50 a page.
- undo (writes, destructive): removes exactly the lines one import added; lines of other imports it held count again.
- profiles (reads): the CSV import profiles, the user's and those shipped with Gousset, and how each reads a file. With import (a CSV import's id): those that read its file, and the one it used.

More examples:
{"action":"upload","file_name":"export.csv","content":"date;label;amount...","account":"Joint account"}
{"action":"undo","import":"<the id that upload or list gave>"}`;

/** A call's arguments, as an example writes them. */
type Arguments = { readonly [key: string]: string | number };

const call = (args: Arguments) => `imports ${JSON.stringify(args)}`;

const refuse = (message: string, example: Arguments) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

/** A name or file name cut to `length`, so that one long name never fills a page. */
function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const STILL_RUNNING = new Set(["queued", "reading", "saving"]);

/** How often an upload reads its import again, and for how long, before it answers. */
const POLL = Duration.millis(500);
const SETTLE_POLLS = 30;

function period(summary: ImportSummary): string {
  return summary.periodFrom === null || summary.periodTo === null
    ? "no period yet"
    : `${summary.periodFrom} to ${summary.periodTo}`;
}

function accountName(summary: ImportSummary): string {
  return summary.account === null ? "no account yet" : summary.account.name;
}

function counts(summary: ImportSummary): string {
  return `${summary.linesRead} lines read: ${summary.linesAdded} added, ${summary.linesDuplicate} already known (duplicates), ${summary.linesHeld} held for review as near duplicates`;
}

/** Some banks write a balance of 0.00 for an account that is not empty: the import ignored it. */
function balanceText(summary: ImportSummary): string {
  return summary.balanceIgnored
    ? "The file's balance looks empty and was ignored: it says 0, while the account's lines make it something else that day. The account is not checked against it."
    : "";
}

/** Where the job stands, in its steps (read, deduplicate, save). */
function stepOf(summary: ImportSummary): string {
  const all = IMPORT_STEPS.join(", ");

  switch (summary.status) {
    case "queued": {
      return `queued: none of its steps (${all}) has started yet`;
    }

    case "reading": {
      return `running: step read (1 of ${IMPORT_STEPS.length})`;
    }

    case "saving": {
      return `running: step save (${IMPORT_STEPS.length} of ${IMPORT_STEPS.length})`;
    }

    case "done": {
      return `done: all ${IMPORT_STEPS.length} steps (${all}) done`;
    }

    case "waiting": {
      return summary.waitingFor === "profile"
        ? "waiting: for the CSV's columns to be confirmed"
        : "waiting: for its account to be chosen";
    }

    case "failed": {
      return "failed";
    }

    case "undone": {
      return "undone";
    }
  }
}

/** Why an import failed, in words, with what to do. */
function failureText(code: string | null): string {
  switch (code) {
    case "CURRENCY_MISMATCH": {
      return "The file's currency is not its account's. Upload it again naming, with account, an account in the file's currency.";
    }

    case "QUEUE_UNAVAILABLE": {
      return "Gousset could not start the import. Upload the file again in a moment.";
    }

    case "NEEDS_CURRENCY":
    case "NEEDS_PROFILE": {
      return "The file needs its account (and, for a CSV, its columns) to be read. Upload it again naming its account, or finish it on Gousset's import screen.";
    }

    case "NotAStatement":
    case "MalformedFile":
    case "MissingField":
    case "InvalidField":
    case "UnsupportedContent":
    case "InvalidOption": {
      return `The file could not be read as a statement (${code}). Check it is the bank's export, whole and unchanged, or name its format with format; then upload it again.`;
    }

    default: {
      return `It failed on Gousset's side (${code ?? "no reason recorded"}). Upload the file again; if it keeps failing, tell the administrator.`;
    }
  }
}

/** One import, as status answers it. */
function statusText(summary: ImportSummary): string {
  return [
    `${summary.fileName} (${summary.format}): ${stepOf(summary)}.`,
    `Account: ${accountName(summary)}. Period: ${period(summary)}.`,
    `${counts(summary)}.`,
    balanceText(summary),
    summary.status === "failed" ? failureText(summary.errorCode) : "",
    `Import id: ${summary.id}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function waitingText(
  summary: ImportSummary,
  accounts: ReadonlyArray<ImportAccount>,
  viaFileUpload: boolean,
): string {
  if (summary.waitingFor === "profile") {
    return `${summary.fileName} waits for its CSV columns to be confirmed: the user confirms them on Gousset's import screen (Imports), where this import waits. Then call: ${call({ action: "status", import: summary.id })}`;
  }

  const names = accounts.map((each) => each.name);
  const example = names[0] ?? "Current account";

  return [
    `${summary.fileName} waits for its account: the file does not say which of the user's accounts it is.`,
    names.length === 0
      ? "The user has no open account yet: one must be added in Gousset first."
      : `The user's accounts: ${names.join(", ")}.`,
    viaFileUpload
      ? `Send it again through a new file upload naming the account (create_upload with file_name, size and account: "${example}"), or choose the account on Gousset's import screen, where this import waits.`
      : `Upload it again naming the account, as ${call({ action: "upload", file_name: summary.fileName, content: "…", account: example })}, or choose the account on Gousset's import screen, where this import waits.`,
    `Import id: ${summary.id}`,
  ].join("\n");
}

function doneText(summary: ImportSummary): string {
  return [
    `Imported ${summary.fileName} into ${accountName(summary)}, ${period(summary)}.`,
    `${counts(summary)}.`,
    summary.linesHeld > 0
      ? "The lines held wait for the user's review: they count only once confirmed."
      : "",
    balanceText(summary),
    `Import id: ${summary.id} (to undo it: ${call({ action: "undo", import: summary.id })})`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function sameFileText(started: Started): string {
  return started.sameFile === null
    ? ""
    : `This same file was already imported, as ${started.sameFile.fileName} on ${started.sameFile.importedAt.slice(0, 10)}: nothing is added twice.\n\n`;
}

const IMPORT_NOT_FOUND = (importId: string) =>
  refuse(
    `The user has no import with the id ${clip(importId, 60)}. List the imports to find its id.`,
    { action: "list" },
  );

/** The database did not answer: no refusal, the call fails as an error on Gousset's side. */
const failure = <Failed>(failed: Failed) => Effect.die(failed);

const UNAVAILABLE = () =>
  refuse("Gousset could not start the import just now. Try the same call again in a moment.", {
    action: "list",
  });

/** The account the user named, matched by name in any case, or a refusal naming the accounts. */
function namedAccount(
  owner: string,
  name: string,
  example: Arguments,
): Effect.Effect<string, ToolRefusal, Imports> {
  return Effect.gen(function* () {
    const imports = yield* Imports;
    const accounts = yield* imports.accounts(owner).pipe(Effect.orDie);
    const wanted = name.trim().toLowerCase();
    const matching = accounts.filter((each) => each.name.trim().toLowerCase() === wanted);
    const [only] = matching;
    const names = accounts.map((each) => each.name);

    if (matching.length === 1 && only !== undefined) {
      return only.id;
    }

    if (names.length === 0) {
      return yield* refuse(
        `No account is named ${clip(name, 80)}: the user has no open account yet. Add one in Gousset first, or leave account out when the file names its account (IBAN or number).`,
        example,
      );
    }

    const why =
      matching.length > 1
        ? `Several accounts are named ${clip(name, 80)}: Gousset cannot tell which one is meant.`
        : `No account is named ${clip(name, 80)}.`;

    return yield* refuse(
      `${why} The user's accounts: ${clip(names.join(", "), 1200)}. Name one of them exactly, or leave account out when the file names its account.`,
      { ...example, account: names[0] ?? "Current account" },
    );
  });
}

const decodeBase64 = Schema.decodeUnknownExit(Schema.Uint8ArrayFromBase64);

/** The file's bytes, from exactly one of content and content_base64. */
function bytesOf(input: ImportsInput, fileName: string): Effect.Effect<Uint8Array, ToolRefusal> {
  const example = { action: "upload", file_name: fileName, content: "…" };

  if (input.content !== undefined && input.content_base64 !== undefined) {
    return refuse(
      "Give the file once: content (its text) or content_base64 (its bytes in base64), not both.",
      example,
    );
  }

  if (input.content !== undefined) {
    return Effect.succeed(new TextEncoder().encode(input.content));
  }

  if (input.content_base64 === undefined) {
    return refuse(
      "upload needs the file: content (its text) or content_base64 (its bytes in base64, for a file not in UTF-8).",
      example,
    );
  }

  const decoded = decodeBase64(input.content_base64.replaceAll(/\s/g, ""));

  return Exit.isSuccess(decoded)
    ? Effect.succeed(decoded.value)
    : refuse(
        "content_base64 is not valid base64. Give the file's bytes in base64, or its text in content.",
        example,
      );
}

/** Reads the import again until it no longer runs, for 15 seconds at most. */
function settle(owner: string, summary: ImportSummary) {
  return Effect.gen(function* () {
    const imports = yield* Imports;
    let current = summary;

    for (let poll = 0; poll < SETTLE_POLLS && STILL_RUNNING.has(current.status); poll += 1) {
      yield* Effect.sleep(POLL);
      current = yield* imports.show(owner, summary.id);
    }

    return current;
  });
}

function settledText(
  owner: string,
  started: Started,
  summary: ImportSummary,
  viaFileUpload: boolean,
): Effect.Effect<string, never, Imports> {
  return Effect.gen(function* () {
    const notice = sameFileText(started);

    switch (summary.status) {
      case "done": {
        return `${notice}${doneText(summary)}`;
      }

      case "waiting": {
        const imports = yield* Imports;

        const accounts =
          summary.waitingFor === "account" ? yield* imports.accounts(owner).pipe(Effect.orDie) : [];

        return `${notice}${waitingText(summary, accounts, viaFileUpload)}`;
      }

      case "failed": {
        return `${notice}The import of ${summary.fileName} failed. ${failureText(summary.errorCode)}\nImport id: ${summary.id}`;
      }

      case "queued":
      case "reading":
      case "saving":
      case "undone": {
        return `${notice}The import of ${summary.fileName} is still running (${stepOf(summary)}). Follow it with: ${call({ action: "status", import: summary.id })}`;
      }
    }
  });
}

function upload(input: ImportsInput, owner: string) {
  return Effect.gen(function* () {
    const fileName = input.file_name;

    if (fileName === undefined || fileName.trim() === "") {
      return yield* refuse(
        "upload needs file_name: the file's name with its extension, which tells its format.",
        { action: "upload", file_name: "october.ofx", content: "…" },
      );
    }

    const content = yield* bytesOf(input, fileName);

    const accountId =
      input.account === undefined
        ? null
        : yield* namedAccount(owner, input.account, {
            action: "upload",
            file_name: fileName,
            content: "…",
          });

    const format: ImportFormat | null = input.format ?? null;
    const imports = yield* Imports;
    const started = yield* imports.start(owner, { fileName, content, format, accountId });
    const settled = yield* settle(owner, started.started);

    return yield* settledText(owner, started, settled, false);
  }).pipe(
    Effect.catchTags({
      EmptyFile: () =>
        refuse("The file is empty: give its whole content.", {
          action: "upload",
          file_name: "october.ofx",
          content: "…",
        }),
      FileTooLarge: (tooLarge) =>
        refuse(
          `The file is ${(tooLarge.bytes / 1024 / 1024).toFixed(1)} MB; an import takes ${tooLarge.limit / 1024 / 1024} MB at most. Export a shorter period from the bank and upload that.`,
          { action: "upload", file_name: "october.ofx", content: "…" },
        ),
      UnknownFormat: () =>
        refuse(
          `Gousset cannot tell this file's format from its name or content. Name it with format: one of ${FORMATS.join(", ")}.`,
          {
            action: "upload",
            file_name: input.file_name ?? "statement.xml",
            content: "…",
            format: "camt053",
          },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          action: "upload",
          file_name: input.file_name ?? "statement.xml",
          content: "…",
          account: "Current account",
        }),
      ImportUnavailable: UNAVAILABLE,
      ImportNotFound: (missing) => IMPORT_NOT_FOUND(missing.importId),
      QueryFailed: failure,
    }),
  );
}

/** Where the upload route serves (apps/web): the app's own address, then a file upload's token. */
const UPLOAD_PATH = "/api/import-uploads/";

const CREATE_EXAMPLE = { action: "create_upload", file_name: "statement.ofx", size: 1_048_576 };

/** A word of a shell command, quoted whole. */
const quoted = (word: string) => `'${word.replaceAll("'", String.raw`'\''`)}'`;

/** The command that sends a file, or one numbered part of it, to an upload address. */
function curlOf(path: string, address: string, part: number | null): string {
  const numbered = part === null ? "" : ` -F part=${part}`;

  return `curl -sS${numbered} -F ${quoted(`file=@${path}`)} ${address}`;
}

function createdText(created: CreatedUpload, origin: string): string {
  const address = `${origin}${UPLOAD_PATH}${created.token}`;
  const name = clip(created.fileName, 100);

  const head = [
    `File upload made for ${name}: ${created.size} bytes, in ${created.parts === 1 ? "one part" : `${created.parts} parts`}, until ${created.expiresAt} (${UPLOAD_MINUTES} minutes). Its address works for this file only and is a secret: write it nowhere but the command.`,
  ];

  const send =
    created.parts === 1
      ? [
          "Send the file from a shell in its folder, as it is (not converted, not compressed):",
          curlOf(created.fileName, address, null),
        ]
      : [
          `Send it in ${created.parts} parts, in order, each with its number: together they are the file as it is, ${created.size} bytes. Split it, for example, with: split -n ${created.parts} -d -a 2 ${quoted(created.fileName)} ${quoted(`${created.fileName}.part`)}`,
          ...Array.from({ length: created.parts }, (_, index) =>
            curlOf(`${created.fileName}.part${String(index).padStart(2, "0")}`, address, index + 1),
          ),
        ];

  return [
    ...head,
    ...send,
    `Each part's answer says what arrived. Then import it: ${call({ action: "upload", file_upload: created.id })}`,
    `File upload id: ${created.id}`,
  ].join("\n");
}

function createUpload(input: ImportsInput, caller: Caller) {
  const owner = caller.userId;
  const { grantId, origin } = caller;

  return Effect.gen(function* () {
    const fileName = input.file_name?.trim().slice(0, 255) ?? "";

    if (fileName === "") {
      return yield* refuse(
        "create_upload needs file_name: the file's name with its extension, which tells its format.",
        CREATE_EXAMPLE,
      );
    }

    if (input.size === undefined) {
      return yield* refuse(
        "create_upload needs size: the file's exact size in bytes, as wc -c < statement.ofx prints it.",
        { ...CREATE_EXAMPLE, file_name: fileName },
      );
    }

    if (input.content !== undefined || input.content_base64 !== undefined) {
      return yield* refuse(
        "create_upload takes no content: the file goes to the address it answers. To give the file's text in the call itself, use upload.",
        { ...CREATE_EXAMPLE, file_name: fileName, size: input.size },
      );
    }

    // The door gives both to every call; a caller without them never made a grant.
    if (grantId === undefined || origin === undefined) {
      return yield* refuse(
        "This connection cannot make a file upload: connect Gousset again through its consent page.",
        { action: "list" },
      );
    }

    const accountId =
      input.account === undefined
        ? null
        : yield* namedAccount(owner, input.account, {
            ...CREATE_EXAMPLE,
            file_name: fileName,
            size: input.size,
          });

    const imports = yield* Imports;

    const created = yield* imports.createUpload(owner, {
      grantId,
      fileName,
      size: input.size,
      parts: input.parts ?? 1,
      accountId,
      format: input.format ?? null,
    });

    return createdText(created, origin);
  }).pipe(
    Effect.catchTags({
      EmptyFile: () =>
        refuse(
          "size is 0: an empty file imports nothing. Give the file's size in bytes.",
          CREATE_EXAMPLE,
        ),
      FileTooLarge: (tooLarge) =>
        refuse(
          `The file is ${(tooLarge.bytes / 1024 / 1024).toFixed(1)} MB; an import takes ${tooLarge.limit / 1024 / 1024} MB at most. Export a shorter period from the bank and upload that.`,
          CREATE_EXAMPLE,
        ),
      TooManyParts: (tooMany) =>
        refuse(
          `parts goes from 1 to ${tooMany.limit}, never more parts than bytes. Most files go in one part: leave parts out.`,
          CREATE_EXAMPLE,
        ),
      TooManyFileUploads: (tooMany) =>
        refuse(
          `The user has ${tooMany.limit} file uploads waiting already, the most at once. Import them (upload with their file_upload) or let them expire, ${UPLOAD_MINUTES} minutes after they were made; then make this one.`,
          { action: "upload", file_upload: "<a file upload's id>" },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          ...CREATE_EXAMPLE,
          account: "Current account",
        }),
      QueryFailed: failure,
    }),
  );
}

/** Imports the file sent to a file upload, as upload imports a file given in the call. */
function uploadFile(input: ImportsInput, caller: Caller, id: string) {
  const owner = caller.userId;
  const again = { action: "upload", file_upload: id };

  return Effect.gen(function* () {
    if (input.content !== undefined || input.content_base64 !== undefined) {
      return yield* refuse(
        "Give the file once: file_upload (a file sent to its address) or content, not both.",
        again,
      );
    }

    const accountId =
      input.account === undefined ? null : yield* namedAccount(owner, input.account, again);

    const imports = yield* Imports;

    const started = yield* imports.startUpload(owner, id, caller.grantId ?? "", {
      format: input.format ?? null,
      accountId,
    });

    const settled = yield* settle(owner, started.started);

    return yield* settledText(owner, started, settled, true);
  }).pipe(
    Effect.catchTags({
      FileUploadNotFound: () =>
        refuse(
          `No file upload ${clip(id, 60)} waits for this connection: it was imported already (a file upload is imported once), it expired and was deleted, or another connection made it. Make a new one and send the file again.`,
          CREATE_EXAMPLE,
        ),
      FileUploadExpired: (expired) =>
        refuse(
          `This file upload expired at ${expired.expiresAt}, before it was imported. Make a new one and send the file again.`,
          CREATE_EXAMPLE,
        ),
      FileUploadIncomplete: (incomplete) =>
        refuse(
          `The file has not all arrived: ${incomplete.partsReceived} of ${incomplete.parts} part(s), ${incomplete.bytesReceived} of ${incomplete.size} bytes. Send the rest to the address create_upload gave, then call upload again.`,
          { action: "status", file_upload: id },
        ),
      UnknownFormat: () =>
        refuse(
          `Gousset cannot tell this file's format from its name or content. Name it with format: one of ${FORMATS.join(", ")}. The file upload waits until it expires.`,
          { ...again, format: "camt053" },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          ...again,
          account: "Current account",
        }),
      // The file upload was used: the import holding its file exists, failed.
      ImportUnavailable: () =>
        refuse(
          "Gousset kept the file but could not start its import just now: the import is listed as failed, and the file upload is used. Find it with list; the user runs it again on Gousset's import screen, or make a new file upload and send the file again.",
          { action: "list" },
        ),
      ImportNotFound: (missing) => IMPORT_NOT_FOUND(missing.importId),
      QueryFailed: failure,
    }),
  );
}

/** One file upload, as status answers it. */
function fileUploadText(status: FileUploadStatus): string {
  const name = clip(status.fileName, 100);

  switch (status.state) {
    case "pending": {
      return [
        `${name}: pending, ${status.partsReceived} of ${status.parts} part(s) received (${status.bytesReceived} of ${status.size} bytes), until ${status.expiresAt}.`,
        status.parts === 1
          ? "Send the file to the address create_upload gave."
          : `Send part ${status.partsReceived + 1} next to the address create_upload gave.`,
        `File upload id: ${status.id}`,
      ].join("\n");
    }

    case "uploaded": {
      return `${name}: uploaded, whole (${status.size} bytes), until ${status.expiresAt}. Import it: ${call({ action: "upload", file_upload: status.id })}`;
    }

    case "expired": {
      return `${name}: expired at ${status.expiresAt}, before it was imported. Make a new file upload and send the file again: ${call({ action: "create_upload", file_name: status.fileName, size: status.size })}`;
    }
  }
}

function fileUploadStatus(owner: string, id: string) {
  return Effect.gen(function* () {
    const imports = yield* Imports;

    return fileUploadText(yield* imports.uploadStatus(owner, id));
  }).pipe(
    Effect.catchTags({
      FileUploadNotFound: () =>
        refuse(
          `The user has no file upload ${clip(id, 60)} waiting: it was imported (then list shows its import), or it expired and was deleted.`,
          { action: "list" },
        ),
      QueryFailed: failure,
    }),
  );
}

function needImport(action: "status" | "undo") {
  return refuse(`${action} needs import: the import's id, as upload and list give it.`, {
    action,
    import: "<an id from list>",
  });
}

function listText(page: ImportPage): string {
  if (page.imports.length === 0) {
    return "No imports here: the user has imported no statement yet (or none older).";
  }

  const lines = page.imports.map(
    (each) =>
      `- ${clip(each.fileName, 100)}, ${clip(accountName(each), 60)}, ${period(each)}, ${each.status}, imported ${each.createdAt.slice(0, 10)}: ${each.linesRead} read, ${each.linesAdded} added, ${each.linesDuplicate} duplicates, ${each.linesHeld} held. Id: ${each.id}`,
  );

  const next =
    page.next === null
      ? "These are all of them."
      : `Older imports: ${call({ action: "list", before: page.next })}`;

  return [`Imports, newest first:`, ...lines, "", next].join("\n");
}

function undoText({
  undone,
  linesRemoved,
  linesGivenBack,
  transfersRemoved,
  laterOverlapping,
  months,
}: Undone) {
  return [
    `Undid the import of ${undone.fileName} (${accountName(undone)}, ${period(undone)}): ${linesRemoved} lines removed.`,
    linesGivenBack > 0
      ? `${linesGivenBack} lines of other imports count again: they were held as near duplicates of its lines.`
      : "",
    transfersRemoved > 0
      ? `${transfersRemoved} transfers its lines were a side of are undone with them: their other sides are no transfer any more, until paired again.`
      : "",
    laterOverlapping > 0
      ? `${laterOverlapping} later imports of this account overlap its period and skipped some of its lines as duplicates: those lines are gone now. Importing its file again brings them back.`
      : "",
    months.length > 0 ? `Months changed: ${months.join(", ")}.` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** How a profile reads a file: `@gousset/import`'s `CsvProfile`, as core lists it. */
type CsvProfile = NonNullable<ImportProfileEntry["definition"]>;

const SEPARATORS = {
  ";": "semicolons",
  ",": "commas",
  "\t": "tabs",
  "|": "pipes",
} satisfies { readonly [separator in CsvProfile["separator"]]: string };

/** How a profile reads a file, in a few words: what an agent needs to choose one. */
function readsText(profile: CsvProfile): string {
  if (profile.layout === "paypal-activity") {
    return "PayPal's activity export, its columns found by their names in English or French, the completed rows that moved the balance in the account's currency, a payment in another currency by its conversion; days and amounts read as the file writes them";
  }

  const { amount } = profile.columns;
  const header = profile.headerRow ? "a header row" : "no header row";

  const top = profile.skipRows === 0 ? header : `${profile.skipRows} lines skipped above ${header}`;

  const amounts =
    amount.kind === "signed"
      ? `one signed amount in column ${amount.column}`
      : `debit in column ${amount.debit} and credit in column ${amount.credit}`;

  return [
    `separated by ${SEPARATORS[profile.separator]}`,
    `encoded ${profile.encoding}`,
    top,
    `dates ${profile.dateFormat}`,
    profile.decimalMark === "," ? "decimal comma" : "decimal point",
    amounts,
  ].join(", ");
}

/** A profile by its name: whose it is, and the institution it reads. */
function profileName(entry: ImportProfileEntry): string {
  const institution = entry.institution === null ? "" : ` (${clip(entry.institution, 60)})`;
  const whose = entry.source === "stored" ? "the user's" : "shipped with Gousset";
  const operations = entry.kind === "operations" ? ", for a broker's operations" : "";

  return `${clip(entry.name, 100)}${institution}, ${whose}${operations}`;
}

const PROFILES_OF_IMPORT = call({ action: "profiles", import: "<a CSV import's id>" });

function profilesText(entries: ReadonlyArray<ImportProfileEntry>): string {
  const lines = entries.map((entry) =>
    entry.definition === null
      ? `- ${profileName(entry)}: its definition can no longer be read; the user saves it again on Gousset's import screen.`
      : `- ${profileName(entry)}: ${readsText(entry.definition)}.`,
  );

  return [
    "CSV import profiles, the user's first, then those shipped with Gousset. A CSV file whose header row is a profile's is read with it on upload.",
    ...lines,
    "",
    `Which of them read one CSV import's file: ${PROFILES_OF_IMPORT}`,
  ].join("\n");
}

function usedText(found: ProfilesForImport): string {
  if (found.used !== null) {
    return `This import read its file with ${clip(found.used.name, 100)}.`;
  }

  return found.status === "done"
    ? "This import names no profile Gousset still has: its columns were detected or confirmed on Gousset's import screen, or the profile it used was deleted since or is no longer shipped."
    : `No profile has read it yet (it is ${found.status}).`;
}

function profilesForText(found: ProfilesForImport): string {
  const fileName = clip(found.fileName, 100);

  const lines = found.fitting.map(
    ({ profile, by }) =>
      `- ${profileName(profile)}: ${by === "header" ? "its header row is the file's" : "a test read of the file's first lines succeeds"}.`,
  );

  return [
    lines.length === 0
      ? `No profile reads ${fileName}: Gousset's import screen proposes its columns from the file, and the user can save them as a profile there.`
      : `Profiles that read ${fileName}:\n${lines.join("\n")}`,
    usedText(found),
  ].join("\n");
}

function profiles(input: ImportsInput, owner: string) {
  const importId = input.import;

  return Effect.gen(function* () {
    const service = yield* ImportProfiles;

    return importId === undefined
      ? profilesText(yield* service.list(owner))
      : profilesForText(yield* service.forImport(owner, importId));
  }).pipe(
    Effect.catchTags({
      ImportNotFound: () =>
        refuse(
          `The user has no CSV import with the id ${clip(importId ?? "", 60)}, or its file was removed by an undo. List the imports to find a CSV one's id, or leave import out to list every profile.`,
          { action: "list" },
        ),
      QueryFailed: failure,
    }),
  );
}

/** The imports family (docs/mcp.md, "Tools"): statements in, without duplicates, and undone. */
export const importsTool = defineTool<
  ImportsInput,
  typeof ImportsInput.Encoded,
  Imports | ImportProfiles
>({
  name: "imports",
  title: "Statement imports",
  description: DESCRIPTION,
  idempotent: false,
  input: ImportsInput,
  example: { action: "list" },
  access: {
    upload: "write",
    create_upload: "write",
    status: "read",
    list: "read",
    undo: "write",
    profiles: "read",
  },
  run: (input, caller) => {
    const owner = caller.userId;

    switch (input.action) {
      case "upload": {
        return input.file_upload === undefined
          ? upload(input, owner)
          : uploadFile(input, caller, input.file_upload);
      }

      case "create_upload": {
        return createUpload(input, caller);
      }

      case "status": {
        const importId = input.import;

        if (input.file_upload !== undefined && importId !== undefined) {
          return refuse("status reads one thing: an import, or a file upload, not both.", {
            action: "status",
            import: importId,
          });
        }

        if (input.file_upload !== undefined) {
          return fileUploadStatus(owner, input.file_upload);
        }

        if (importId === undefined) {
          return needImport("status");
        }

        return Effect.gen(function* () {
          const imports = yield* Imports;

          return statusText(yield* imports.show(owner, importId));
        }).pipe(
          Effect.catchTags({
            ImportNotFound: () => IMPORT_NOT_FOUND(importId),
            QueryFailed: failure,
          }),
        );
      }

      case "list": {
        return Effect.gen(function* () {
          const imports = yield* Imports;

          return listText(yield* imports.list(owner, input.before ?? null));
        }).pipe(Effect.catchTag("QueryFailed", failure));
      }

      case "undo": {
        const importId = input.import;

        if (importId === undefined) {
          return needImport("undo");
        }

        return Effect.gen(function* () {
          const imports = yield* Imports;

          return undoText(yield* imports.undo(owner, importId));
        }).pipe(
          Effect.catchTags({
            ImportNotFound: () => IMPORT_NOT_FOUND(importId),
            ImportBusy: (busy) =>
              busy.status === "undone"
                ? refuse("This import was already undone: there is nothing to do.", {
                    action: "list",
                  })
                : refuse(
                    `This import is still running (${busy.status}): it can be undone once it ends. Wait a moment and follow it with status, then undo it.`,
                    { action: "status", import: importId },
                  ),
            QueryFailed: failure,
          }),
        );
      }

      case "profiles": {
        return profiles(input, owner);
      }
    }
  },
});
