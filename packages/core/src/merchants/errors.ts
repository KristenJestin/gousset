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

/** A merchant is merged into another one, never into itself. */
export class MerchantMergeRefused extends Schema.TaggedError<MerchantMergeRefused>()(
  "MerchantMergeRefused",
  { merchantId: Schema.String },
) {}
