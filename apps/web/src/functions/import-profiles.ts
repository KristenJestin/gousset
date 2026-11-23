import { ImportProfiles } from "@gousset/core";
import { CsvProfile } from "@gousset/import";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn } from "./month";

// The import screen's calls for CSV profiles (#19), on `@gousset/core`'s `ImportProfiles`, as the
// MCP door's `imports` tool reads them. A refusal comes back as a code the screen translates.

/** A profile chosen to read a file: one of the user's, by id, or one shipped, by key. */
export const ProfileChoiceInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stored"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("shipped"), key: Schema.String }),
]);

const ProfileIdInput = Schema.Struct({ profileId: Schema.String });

/** The user's profiles, by name, then those shipped with Gousset. */
export const listImportProfiles = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(({ context }) =>
    runCore(ImportProfiles.use((profiles) => profiles.list(context.owner))),
  );

/**
 * Saves a profile made from a preview: its name, the institution or `null`, how it reads, and the
 * header of the file it was made on (normalised, as the CSV questions give it), or `null`.
 */
export const saveImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        name: Schema.String,
        institution: Schema.NullOr(Schema.String),
        definition: CsvProfile,
        header: Schema.NullOr(Schema.String),
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.save(context.owner, data)).pipe(
        Effect.map((saved) => ({ saved })),
        Effect.catchTag("ProfileNameMissing", () =>
          Effect.succeed({ refused: "PROFILE_NAME_MISSING" }),
        ),
      ),
    ),
  );

export const renameImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ profileId: Schema.String, name: Schema.String })),
  )
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) =>
        profiles.rename(context.owner, data.profileId, data.name),
      ).pipe(
        Effect.map((renamed) => ({ renamed })),
        Effect.catchTags({
          ProfileNotFound: () => Effect.succeed({ refused: "PROFILE_NOT_FOUND" }),
          ProfileNameMissing: () => Effect.succeed({ refused: "PROFILE_NAME_MISSING" }),
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

/** Saves a profile shared as a file, under the name the user gives it. */
export const importImportProfile = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        name: Schema.String,
        institution: Schema.NullOr(Schema.String),
        content: Schema.String,
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      ImportProfiles.use((profiles) => profiles.importFile(context.owner, data)).pipe(
        Effect.map((saved) => ({ saved })),
        Effect.catchTags({
          InvalidProfileFile: (invalid) =>
            Effect.succeed({ refused: "INVALID_PROFILE_FILE", problem: invalid.problem }),
          ProfileNameMissing: () => Effect.succeed({ refused: "PROFILE_NAME_MISSING" }),
        }),
      ),
    ),
  );
