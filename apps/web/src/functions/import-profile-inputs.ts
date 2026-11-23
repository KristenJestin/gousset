import { MAX_PROFILE_FILE, MAX_PROFILE_HEADER, MAX_PROFILE_NAME } from "@gousset/core/imports";
import { CsvProfile } from "@gousset/import";
import { Schema } from "effect";

// What the import screen sends to keep a CSV profile. A name or an institution is bounded loosely
// here, ten times what core keeps: core trims it, then refuses one too long with `ProfileTooLong`,
// a code the screen translates, which a refusal here would not be. The header and a shared file,
// which core does not trim, are bounded as core bounds them, a file before its JSON is parsed.

const ProfileName = Schema.String.check(Schema.isMaxLength(MAX_PROFILE_NAME * 10));

/** A profile made from a preview, as `saveImportProfile` takes it. */
export const SaveProfileInput = Schema.Struct({
  name: ProfileName,
  institution: Schema.NullOr(ProfileName),
  definition: CsvProfile,
  header: Schema.NullOr(Schema.String.check(Schema.isMaxLength(MAX_PROFILE_HEADER))),
});

/** A new name for one of the user's profiles, as `renameImportProfile` takes it. */
export const RenameProfileInput = Schema.Struct({ profileId: Schema.String, name: ProfileName });

/** A profile shared as a file, as `importImportProfile` takes it. */
export const ImportProfileInput = Schema.Struct({
  name: ProfileName,
  institution: Schema.NullOr(ProfileName),
  content: Schema.String.check(Schema.isMaxLength(MAX_PROFILE_FILE)),
});
