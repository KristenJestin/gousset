import { account, importFile, importProfile, statementImport } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import {
  CsvProfile,
  SHIPPED_PROFILES,
  csvFile,
  headerMatches,
  matchCsvHeader,
  readCsvHeader,
  shippedProfile,
  testReadCsv,
} from "@gousset/import";
import type { CsvFile, ShippedProfile } from "@gousset/import";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect";

import {
  ImportNotFound,
  InvalidProfileFile,
  ProfileNameMissing,
  ProfileNotFound,
  ProfileTooLong,
  ProfileUnreadable,
  TooManyProfiles,
} from "./errors";
import { isId } from "./rows";
import { MAX_PROFILE_FILE, MAX_PROFILE_HEADER, MAX_PROFILE_NAME, MAX_PROFILES } from "./summary";
import type {
  ImportProfileEntry,
  ProfileChoice,
  ProfileDraft,
  ProfileFile,
  ProfileFit,
  ProfilesForImport,
} from "./summary";

// Import profiles (#19, docs/data-model.md, "Import profiles"): the user's own, kept in
// `import_profile`, and those shipped with Gousset (`@gousset/import`), listed together for the
// import screen and the MCP door. A stored definition is decoded by `CsvProfile` on its way out:
// one that no longer reads is listed as such, never thrown.

type StoredEntry = Extract<ImportProfileEntry, { source: "stored" }>;

type ShippedEntry = Extract<ImportProfileEntry, { source: "shipped" }>;

const decodeDefinition = Schema.decodeUnknownOption(CsvProfile);

const ProfileJson = Schema.fromJsonString(CsvProfile);

const decodeFile = Schema.decodeUnknownExit(ProfileJson);

const storedColumns = {
  id: importProfile.id,
  name: importProfile.name,
  institution: importProfile.institution,
  kind: importProfile.kind,
  header: importProfile.header,
  definition: importProfile.definition,
};

type StoredRow = Pick<
  typeof importProfile.$inferSelect,
  "id" | "name" | "institution" | "kind" | "header" | "definition"
>;

function storedEntry(row: StoredRow): StoredEntry {
  return {
    source: "stored",
    id: row.id,
    name: row.name,
    institution: row.institution,
    kind: row.kind,
    header: row.header,
    definition: Option.getOrNull(decodeDefinition(row.definition)),
  };
}

function shippedEntry(shipped: ShippedProfile): ShippedEntry {
  return {
    source: "shipped",
    key: shipped.key,
    name: shipped.name,
    institution: null,
    kind: shipped.kind,
    header: shipped.header,
    definition: shipped.profile,
  };
}

const SHIPPED_ENTRIES: ReadonlyArray<ShippedEntry> = SHIPPED_PROFILES.map(shippedEntry);

/** A profile that may read a file, and what an import records of it once it does. */
export type ProfileCandidate = {
  readonly header: string | null;
  readonly profile: CsvProfile;
  readonly profileId: string | null;
  readonly shippedProfile: string | null;
};

/**
 * The user's profiles that read statements, in the order a CSV file is matched against them: the
 * most recently updated first. At most `MAX_PROFILES`, which saving keeps them under: the limit
 * here bounds the profiles tried on a file even past two saves made at once.
 */
const statementProfiles = (transaction: UserTransaction): Promise<ReadonlyArray<StoredRow>> =>
  transaction
    .select(storedColumns)
    .from(importProfile)
    .where(eq(importProfile.kind, "statement"))
    .orderBy(desc(importProfile.updatedAt), desc(importProfile.id))
    .limit(MAX_PROFILES);

/**
 * The profiles a CSV statement is matched against, in order: the user's that read statements and
 * still decode, the most recently updated first, then the shipped ones.
 */
export async function profileCandidates(
  transaction: UserTransaction,
): Promise<ReadonlyArray<ProfileCandidate>> {
  const rows = await statementProfiles(transaction);

  const stored = rows.flatMap((row): Array<ProfileCandidate> => {
    const definition = decodeDefinition(row.definition);

    return Option.isSome(definition)
      ? [{ header: row.header, profile: definition.value, profileId: row.id, shippedProfile: null }]
      : [];
  });

  const shipped = SHIPPED_PROFILES.map((each): ProfileCandidate => ({
    header: each.header,
    profile: each.profile,
    profileId: null,
    shippedProfile: each.key,
  }));

  return [...stored, ...shipped];
}

/**
 * The first candidate whose header the file has (`matchCsvHeader`), or `undefined`. The file is
 * decoded once, and each candidate reads its top only.
 */
export const matchProfile = (
  bytes: Uint8Array,
  candidates: ReadonlyArray<ProfileCandidate>,
): Effect.Effect<ProfileCandidate | undefined> => matchCsvHeader(csvFile(bytes), candidates);

/** A text no longer than `limit` characters, or `ProfileTooLong` for `field`. */
function withinLength(
  field: ProfileTooLong["field"],
  text: string,
  limit: number,
): Effect.Effect<string, ProfileTooLong> {
  return text.length > limit
    ? Effect.fail(new ProfileTooLong({ field, limit }))
    : Effect.succeed(text);
}

/** A name as kept: trimmed; a blank one is refused, and one too long. */
function nameOf(name: string): Effect.Effect<string, ProfileNameMissing | ProfileTooLong> {
  const trimmed = name.trim();

  return trimmed === ""
    ? Effect.fail(new ProfileNameMissing())
    : withinLength("name", trimmed, MAX_PROFILE_NAME);
}

function institutionOf(institution: string | null): Effect.Effect<string | null, ProfileTooLong> {
  const trimmed = institution?.trim() ?? "";

  return trimmed === ""
    ? Effect.succeed(null)
    : withinLength("institution", trimmed, MAX_PROFILE_NAME);
}

/** A file name from the profile's name: letters and digits, the rest a dash. */
function fileNameOf(name: string): string {
  const base = name
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60);

  return `${base === "" ? "profile" : base}.gousset-profile.json`;
}

/** How much of a decoding error a refusal quotes: enough to say what is wrong. */
const PROBLEM_LENGTH = 600;

type Failure = QueryFailed;

/** Why a profile is not kept: no name, a text too long, or as many profiles kept as allowed. */
type Refused = ProfileNameMissing | ProfileTooLong | TooManyProfiles;

/** The user's import profiles and those shipped with Gousset, for the user `owner` of each call. */
export class ImportProfiles extends Context.Service<
  ImportProfiles,
  {
    /** The user's profiles, by name, then the shipped ones, in their order. */
    readonly list: (owner: string) => Effect.Effect<ReadonlyArray<ImportProfileEntry>, Failure>;
    readonly show: (
      owner: string,
      choice: ProfileChoice,
    ) => Effect.Effect<ImportProfileEntry, ProfileNotFound | Failure>;
    /**
     * Saves a new profile of the user's, a statement's: from the import screen's preview, with the
     * header of the file it was made on, so that the next file with that header is read with it.
     */
    readonly save: (
      owner: string,
      draft: ProfileDraft,
    ) => Effect.Effect<ImportProfileEntry, Refused | Failure>;
    readonly rename: (
      owner: string,
      profileId: string,
      name: string,
    ) => Effect.Effect<
      ImportProfileEntry,
      ProfileNotFound | ProfileNameMissing | ProfileTooLong | Failure
    >;
    /** Deletes one of the user's profiles; the imports it read forget it, and keep their lines. */
    readonly remove: (
      owner: string,
      profileId: string,
    ) => Effect.Effect<void, ProfileNotFound | Failure>;
    /** The profile's definition as a file to share: its JSON, `CsvProfile`'s. */
    readonly exportFile: (
      owner: string,
      choice: ProfileChoice,
    ) => Effect.Effect<ProfileFile, ProfileNotFound | ProfileUnreadable | Failure>;
    /**
     * Saves a profile shared as a file (`exportFile`'s) under the name the user gives it. It
     * recognises no file by its header until saved again from a preview. A file longer than
     * `MAX_PROFILE_FILE` is refused before it is parsed.
     */
    readonly importFile: (
      owner: string,
      shared: {
        readonly name: string;
        readonly institution: string | null;
        readonly content: string;
      },
    ) => Effect.Effect<ImportProfileEntry, InvalidProfileFile | Refused | Failure>;
    /**
     * The definition of a chosen profile and what an import records of it: refused for a profile
     * the user does not have, or one that no longer reads.
     */
    readonly resolve: (
      owner: string,
      choice: ProfileChoice,
    ) => Effect.Effect<ProfileCandidate, ProfileNotFound | ProfileUnreadable | Failure>;
    /**
     * Which profiles read a CSV import's file: those whose header is the file's, then those with no
     * header whose test read of the file's top passes, each in the order an upload tries them
     * (`ProfilesForImport`); and the profile the import used.
     */
    readonly forImport: (
      owner: string,
      importId: string,
    ) => Effect.Effect<ProfilesForImport, ImportNotFound | Failure>;
  }
>()("@gousset/core/ImportProfiles") {}

/** One of the user's profiles, by id. */
const findStored = (
  owner: string,
  profileId: string,
): Effect.Effect<StoredEntry, ProfileNotFound | Failure, UserData> =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const found = isId(profileId)
      ? yield* userData.transaction(owner, async (transaction) => {
          const [row] = await transaction
            .select(storedColumns)
            .from(importProfile)
            .where(eq(importProfile.id, profileId));

          return row === undefined ? undefined : storedEntry(row);
        })
      : undefined;

    if (found === undefined) {
      return yield* new ProfileNotFound({ profile: profileId });
    }

    return found;
  });

/** A profile chosen by id or key, whether or not its definition still reads. */
const showProfile = (
  owner: string,
  choice: ProfileChoice,
): Effect.Effect<ImportProfileEntry, ProfileNotFound | Failure, UserData> => {
  if (choice.kind === "stored") {
    return findStored(owner, choice.id);
  }

  const shipped = shippedProfile(choice.key);

  return shipped === undefined
    ? Effect.fail(new ProfileNotFound({ profile: choice.key }))
    : Effect.succeed(shippedEntry(shipped));
};

/** A chosen profile and its definition, or why it has none. */
const chosenDefinition = (owner: string, choice: ProfileChoice) =>
  Effect.flatMap(showProfile(owner, choice), (entry) =>
    entry.definition === null
      ? Effect.fail(
          new ProfileUnreadable({ profile: choice.kind === "stored" ? choice.id : choice.key }),
        )
      : Effect.succeed({ entry, definition: entry.definition }),
  );

/**
 * The definition of a profile chosen by id or key, and what an import records of it: refused for a
 * profile the user does not have, or one that no longer reads. `Imports.resume` reads with it.
 */
export const resolveProfile = (
  owner: string,
  choice: ProfileChoice,
): Effect.Effect<ProfileCandidate, ProfileNotFound | ProfileUnreadable | Failure, UserData> =>
  Effect.map(chosenDefinition(owner, choice), ({ entry, definition }) => ({
    header: entry.header,
    profile: definition,
    profileId: entry.source === "stored" ? entry.id : null,
    shippedProfile: entry.source === "shipped" ? entry.key : null,
  }));

/** `ImportProfiles` on the database (`UserData`). */
export const importProfilesLayer = Layer.effect(
  ImportProfiles,
  Effect.gen(function* () {
    const userData = yield* UserData;

    const inTransaction = <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
      userData.transaction(owner, work);

    const withUserData = <A, E>(effect: Effect.Effect<A, E, UserData>) =>
      Effect.provideService(effect, UserData, userData);

    const definitionOf = (owner: string, choice: ProfileChoice) =>
      withUserData(chosenDefinition(owner, choice));

    const insert = (owner: string, draft: ProfileDraft) =>
      Effect.gen(function* () {
        const name = yield* nameOf(draft.name);
        const institution = yield* institutionOf(draft.institution);

        const header =
          draft.header === null
            ? null
            : yield* withinLength("header", draft.header, MAX_PROFILE_HEADER);

        const inserted = yield* inTransaction(owner, async (transaction) => {
          const [kept] = await transaction.select({ total: count() }).from(importProfile);

          if ((kept?.total ?? 0) >= MAX_PROFILES) {
            return { full: true, row: undefined };
          }

          const [row] = await transaction
            .insert(importProfile)
            .values({
              userId: owner,
              name,
              institution,
              kind: "statement",
              definition: draft.definition,
              header,
            })
            .returning(storedColumns);

          return { full: false, row };
        });

        if (inserted.full) {
          return yield* new TooManyProfiles({ limit: MAX_PROFILES });
        }

        if (inserted.row === undefined) {
          return yield* Effect.die(new Error("The insert returned no row."));
        }

        return storedEntry(inserted.row);
      });

    return {
      list: (owner) =>
        inTransaction(owner, (transaction) =>
          transaction
            .select(storedColumns)
            .from(importProfile)
            .orderBy(asc(importProfile.name), asc(importProfile.id)),
        ).pipe(
          Effect.map((rows): ReadonlyArray<ImportProfileEntry> => [
            ...rows.map(storedEntry),
            ...SHIPPED_ENTRIES,
          ]),
        ),

      show: (owner, choice) => withUserData(showProfile(owner, choice)),

      save: insert,

      rename: (owner, profileId, name) =>
        Effect.gen(function* () {
          const renamed = yield* nameOf(name);

          if (!isId(profileId)) {
            return yield* new ProfileNotFound({ profile: profileId });
          }

          const [row] = yield* inTransaction(owner, (transaction) =>
            transaction
              .update(importProfile)
              .set({ name: renamed })
              .where(eq(importProfile.id, profileId))
              .returning(storedColumns),
          );

          if (row === undefined) {
            return yield* new ProfileNotFound({ profile: profileId });
          }

          return storedEntry(row);
        }),

      remove: (owner, profileId) =>
        Effect.gen(function* () {
          if (!isId(profileId)) {
            return yield* new ProfileNotFound({ profile: profileId });
          }

          const removed = yield* inTransaction(owner, (transaction) =>
            transaction
              .delete(importProfile)
              .where(eq(importProfile.id, profileId))
              .returning({ id: importProfile.id }),
          );

          if (removed.length === 0) {
            return yield* new ProfileNotFound({ profile: profileId });
          }
        }),

      exportFile: (owner, choice) =>
        Effect.map(definitionOf(owner, choice), ({ entry, definition }) => ({
          fileName: fileNameOf(entry.name),
          content: `${JSON.stringify(Schema.encodeSync(CsvProfile)(definition), null, 2)}\n`,
        })),

      importFile: (owner, shared) =>
        Effect.gen(function* () {
          const content = yield* withinLength("file", shared.content, MAX_PROFILE_FILE);
          const decoded = decodeFile(content);

          if (Exit.isFailure(decoded)) {
            const issue = Cause.squash(decoded.cause);

            const problem =
              issue instanceof Error ? issue.message : "It holds no profile Gousset reads.";

            return yield* new InvalidProfileFile({ problem: problem.slice(0, PROBLEM_LENGTH) });
          }

          return yield* insert(owner, {
            name: shared.name,
            institution: shared.institution,
            definition: decoded.value,
            header: null,
          });
        }),

      resolve: (owner, choice) => withUserData(resolveProfile(owner, choice)),

      forImport: (owner, importId) =>
        Effect.gen(function* () {
          const found = yield* inTransaction(owner, async (transaction) => {
            if (!isId(importId)) {
              return undefined;
            }

            const [row] = await transaction
              .select({
                fileName: statementImport.fileName,
                status: statementImport.status,
                profileId: statementImport.profileId,
                shippedProfile: statementImport.shippedProfile,
                currency: account.currency,
                content: importFile.content,
              })
              .from(statementImport)
              .innerJoin(importFile, eq(importFile.importId, statementImport.id))
              .leftJoin(account, eq(account.id, statementImport.accountId))
              .where(and(eq(statementImport.id, importId), eq(statementImport.format, "csv")));

            if (row === undefined) {
              return undefined;
            }

            const stored = await statementProfiles(transaction);

            return { row, stored: stored.map(storedEntry) };
          });

          if (found === undefined) {
            return yield* new ImportNotFound({ importId });
          }

          const { row, stored } = found;

          // In the order an upload tries them (`profileCandidates`): at most fifty of the user's and
          // the shipped ones, on a file decoded once, each reading its top only.
          const entries: ReadonlyArray<ImportProfileEntry> = [...stored, ...SHIPPED_ENTRIES];
          const file = csvFile(row.content);

          const tried = yield* Effect.forEach(entries, (entry) => fits(file, entry, row.currency));
          const fitting = tried.flatMap((fit) => (fit === undefined ? [] : [fit]));

          const used =
            entries.find(
              (entry) =>
                (entry.source === "stored" && entry.id === row.profileId) ||
                (entry.source === "shipped" && entry.key === row.shippedProfile),
            ) ?? null;

          return {
            fileName: row.fileName,
            status: row.status,
            used,
            // A header match before a test read, as an upload reads a file by its header only.
            fitting: [
              ...fitting.filter((fit) => fit.by === "header"),
              ...fitting.filter((fit) => fit.by === "test-read"),
            ],
          };
        }),
    };
  }),
);

/** How a profile reads a file: by its header, by a test read when it keeps none, or not at all. */
const fits = (
  file: CsvFile,
  entry: ImportProfileEntry,
  currency: string | null,
): Effect.Effect<ProfileFit | undefined> => {
  const { definition } = entry;

  if (definition === null) {
    return Effect.succeed(undefined);
  }

  if (entry.header !== null) {
    return readCsvHeader(file, definition).pipe(
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (header) =>
          headerMatches({ header: entry.header, profile: definition }, header)
            ? { profile: entry, by: "header" }
            : undefined,
      }),
    );
  }

  return testReadCsv(file, definition, currency).pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: () => ({ profile: entry, by: "test-read" }),
    }),
  );
};
