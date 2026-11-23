import { ImportProfiles } from "@gousset/core";
import type { ProfileTooLong, TooManyProfiles } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { ImportProfileInput, RenameProfileInput, SaveProfileInput } from "./import-profile-inputs";
import { signedIn } from "./month";

// The import screen's calls for CSV profiles (#19), on `@gousset/core`'s `ImportProfiles`, as the
// MCP door's `imports` tool reads them. A refusal comes back as a code the screen translates.

/** A profile chosen to read a file: one of the user's, by id, or one shipped, by key. */
export const ProfileChoiceInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stored"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("shipped"), key: Schema.String }),
]);

const ProfileIdInput = Schema.Struct({ profileId: Schema.String });

/** A text past its length: which, and the most it takes, for the screen to say. */
const tooLong = (refusal: ProfileTooLong) =>
  Effect.succeed({ refused: "PROFILE_TOO_LONG", field: refusal.field, limit: refusal.limit });

/** As many profiles kept as allowed: one is deleted before another is saved. */
const tooMany = (refusal: TooManyProfiles) =>
  Effect.succeed({ refused: "TOO_MANY_PROFILES", limit: refusal.limit });

/** The user's profiles, by name, then those shipped with Gousset. */
export const listImportProfiles = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(({ context }) =>
    runCore(ImportProfiles.use((profiles) => profiles.list(context.owner))),
  );

/**
 * The profiles that read a CSV import's file (by its header, then by a test read) and the one it
 * used; `null` for no such import.
 */
export const getImportProfilesFor = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ importId: Schema.String })))
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.forImport(context.owner, data.importId)).pipe(
        Effect.catchTag("ImportNotFound", () => Effect.succeed(null)),
      ),
    ),
  );

/**
 * Saves a profile made from a preview: its name, the institution or `null`, how it reads, and the
 * header of the file it was made on (normalised, as the CSV questions give it), or `null`.
 */
export const saveImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(SaveProfileInput))
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.save(context.owner, data)).pipe(
        Effect.map((saved) => ({ saved })),
        Effect.catchTags({
          ProfileNameMissing: () => Effect.succeed({ refused: "PROFILE_NAME_MISSING" }),
          ProfileTooLong: tooLong,
          TooManyProfiles: tooMany,
        }),
      ),
    ),
  );

export const renameImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(RenameProfileInput))
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) =>
        profiles.rename(context.owner, data.profileId, data.name),
      ).pipe(
        Effect.map((renamed) => ({ renamed })),
        Effect.catchTags({
          ProfileNotFound: () => Effect.succeed({ refused: "PROFILE_NOT_FOUND" }),
          ProfileNameMissing: () => Effect.succeed({ refused: "PROFILE_NAME_MISSING" }),
          ProfileTooLong: tooLong,
        }),
      ),
    ),
  );

/** Deletes one of the user's profiles; the imports it read keep their lines. */
export const deleteImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(ProfileIdInput))
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.remove(context.owner, data.profileId)).pipe(
        Effect.as({ deleted: true }),
        Effect.catchTag("ProfileNotFound", () => Effect.succeed({ refused: "PROFILE_NOT_FOUND" })),
      ),
    ),
  );

/** A profile as a file to share: its name and its JSON. */
export const exportImportProfile = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ profile: ProfileChoiceInput })))
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.exportFile(context.owner, data.profile)).pipe(
        Effect.map((file) => ({ file })),
        Effect.catchTags({
          ProfileNotFound: () => Effect.succeed({ refused: "PROFILE_NOT_FOUND" }),
          ProfileUnreadable: () => Effect.succeed({ refused: "PROFILE_UNREADABLE" }),
        }),
      ),
    ),
  );

/**
 * Saves a profile shared as a file, under the name the user gives it; a file of more than 64 KiB is
 * refused before its JSON is parsed.
 */
export const importImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(ImportProfileInput))
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.importFile(context.owner, data)).pipe(
        Effect.map((saved) => ({ saved })),
        Effect.catchTags({
          InvalidProfileFile: (invalid) =>
            Effect.succeed({ refused: "INVALID_PROFILE_FILE", problem: invalid.problem }),
          ProfileNameMissing: () => Effect.succeed({ refused: "PROFILE_NAME_MISSING" }),
          ProfileTooLong: tooLong,
          TooManyProfiles: tooMany,
        }),
      ),
    ),
  );
