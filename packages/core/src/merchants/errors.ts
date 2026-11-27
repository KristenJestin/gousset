import { Schema } from "effect";

/** No merchant of the user's has this id. */
export class MerchantNotFound extends Schema.TaggedError<MerchantNotFound>()("MerchantNotFound", {
  merchantId: Schema.String,
}) {}

/** No merchant of the user's has this name (any case); `close`, names that contain it. */
export class MerchantNameUnknown extends Schema.TaggedError<MerchantNameUnknown>()(
  "MerchantNameUnknown",
  { name: Schema.String, close: Schema.Array(Schema.String) },
) {}

/** A merchant's name cannot be empty, nor longer than `MAX_MERCHANT_NAME` once trimmed. */
export class MerchantNameRefused extends Schema.TaggedError<MerchantNameRefused>()(
  "MerchantNameRefused",
  { reason: Schema.Literals(["blank", "too_long"]) },
) {}

/** Another merchant of the user's has this name already (any case): merge them instead. */
export class MerchantNameTaken extends Schema.TaggedError<MerchantNameTaken>()(
  "MerchantNameTaken",
  { name: Schema.String },
) {}

/** No merchant of the user's is named by this cleaned label. */
export class MerchantAliasNotFound extends Schema.TaggedError<MerchantAliasNotFound>()(
  "MerchantAliasNotFound",
  { alias: Schema.String },
) {}

/**
 * Who was paid cannot be set on this line (#30): its label names no intermediary, so its merchant is
 * the label's and moving the cleaned label changes it (`not_intermediary`); it is no one entry made
 * of the whole line, as a rule's (held, discarded, a side of a transfer, split, linked, of no
 * amount: `not_one_entry`); or the merchant named is an intermediary itself
 * (`intermediary_chosen`).
 */
export class LineMerchantRefused extends Schema.TaggedError<LineMerchantRefused>()(
  "LineMerchantRefused",
  {
    lineId: Schema.String,
    reason: Schema.Literals(["not_intermediary", "not_one_entry", "intermediary_chosen"]),
  },
) {}

/**
 * A label given to name a merchant (#204) cleans to no key (`merchantKey`): it holds only what never
 * names anyone (a date, a reference, a withdrawal), so no line would ever be named by it.
 */
export class MerchantLabelRefused extends Schema.TaggedError<MerchantLabelRefused>()(
  "MerchantLabelRefused",
  { label: Schema.String },
) {}

/**
 * A label given to name a merchant (#204) cleans to a key that names another merchant already
 * (`name`): one cleaned label names one merchant; the user moves it or merges them instead.
 */
export class MerchantLabelTaken extends Schema.TaggedError<MerchantLabelTaken>()(
  "MerchantLabelTaken",
  { label: Schema.String, alias: Schema.String, name: Schema.String },
) {}

/**
 * A logo refused (#204): no byte (`empty`), more than 256 KiB (`too_large`), or neither PNG, JPEG
 * nor WebP by its bytes (`type`).
 */
export class MerchantLogoRefused extends Schema.TaggedError<MerchantLogoRefused>()(
  "MerchantLogoRefused",
  { reason: Schema.Literals(["empty", "too_large", "type"]) },
) {}

/** The merchant has no logo. */
export class MerchantLogoNotFound extends Schema.TaggedError<MerchantLogoNotFound>()(
  "MerchantLogoNotFound",
  { merchantId: Schema.String },
) {}

/** A merchant is merged into another one, never into itself. */
export class MerchantMergeRefused extends Schema.TaggedError<MerchantMergeRefused>()(
  "MerchantMergeRefused",
  { merchantId: Schema.String },
) {}
