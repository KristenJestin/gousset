import { MAX_MERCHANTS_LISTED, Merchants, listMerchants, showMerchant } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

/**
 * Why a write or a read of the merchants was refused, as a code for the interface to translate. A
 * failure of the server itself is thrown, not answered with a code.
 */
export type MerchantRefusalCode =
  | "MERCHANT_NOT_FOUND"
  | "NAME_BLANK"
  | "NAME_TOO_LONG"
  | "NAME_TAKEN"
  | "LABEL_NOT_FOUND"
  | "MERGE_INTO_ITSELF"
  | "MERGE_INTO_UNKNOWN";

/** A refusal, with the merchant's name it is about when there is one (the one taken, say). */
const refused = (code: MerchantRefusalCode, name?: string) =>
  Effect.succeed({ ok: false as const, code, name });

const NAME_CODES = { blank: "NAME_BLANK", too_long: "NAME_TOO_LONG" } as const;

/**
 * Room for anything a person types, and no more: the server never reads a page of text. A name
 * longer than a merchant's may be is the core's to refuse, with a reason the form shows.
 */
const Typed = Schema.String.check(Schema.isMaxLength(1000));

/** A merchant's id as the address or the page gives it; one that names none is not found. */
const MerchantId = Schema.String.check(Schema.isMaxLength(100));

const MerchantListInput = Schema.Struct({
  text: Schema.optional(Typed),
  /** The `next` of the page before. */
  after: Schema.optional(Typed),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_MERCHANTS_LISTED })),
  ),
});

/**
 * The user's merchants by name, a page at a time, those whose name or a cleaned label contains
 * `text` when given, with how many match in all.
 */
export const getMerchants = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(MerchantListInput))
  .handler(({ data, context }) => runCore(listMerchants(context.owner, data)));

/**
 * One merchant: its name, its cleaned labels and its latest lines. One the user does not have comes
 * back as a code.
 */
export const getMerchant = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ merchantId: MerchantId })))
  .handler(({ data, context }) =>
    runCore(
      showMerchant(context.owner, data.merchantId).pipe(
        Effect.map((merchant) => ({ ok: true as const, merchant })),
        Effect.catchTags({
          MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
        }),
      ),
    ),
  );

/**
 * Renames a merchant. Refused with a code: a blank name, one too long, or one another merchant has
 * (any case), which comes back with that merchant's name: the two are merged instead.
 */
export const renameMerchant = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ merchantId: MerchantId, name: Typed })))
  .handler(({ data, context }) =>
    runCore(
      Effect.gen(function* () {
        const merchants = yield* Merchants;

        return yield* merchants.rename(context.owner, data.merchantId, data.name);
      }).pipe(
        Effect.map((merchant) => ({ ok: true as const, merchant })),
        Effect.catchTags({
          MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
          MerchantNameRefused: (refusal) => refused(NAME_CODES[refusal.reason]),
          MerchantNameTaken: (refusal) => refused("NAME_TAKEN", refusal.name),
        }),
      ),
    ),
  );

/**
 * Moves one of a merchant's cleaned labels to the merchant named `to` (any case), made when none
 * has that name: how a merchant that joined two shops is split. Refused with a code: a merchant the
 * user does not have, a label that is not that merchant's, a blank name or one too long.
 */
export const moveMerchantLabel = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ merchantId: MerchantId, label: Typed, to: Typed })),
  )
  .handler(({ data, context }) =>
    runCore(
      Effect.gen(function* () {
        const merchants = yield* Merchants;

        return yield* merchants.moveAlias(context.owner, data.merchantId, data.label, data.to);
      }).pipe(
        Effect.map((moved) => ({ ok: true as const, moved })),
        Effect.catchTags({
          MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
          MerchantAliasNotFound: () => refused("LABEL_NOT_FOUND"),
          MerchantNameRefused: (refusal) => refused(NAME_CODES[refusal.reason]),
        }),
      ),
    ),
  );

/**
 * Merges a merchant into the one named `into` (any case): its cleaned labels move there, then it is
 * deleted. Refused with a code: a merchant the user does not have, a name no merchant has, or the
 * merchant itself.
 */
export const mergeMerchant = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ merchantId: MerchantId, into: Typed })))
  .handler(({ data, context }) =>
    runCore(
      Effect.gen(function* () {
        const merchants = yield* Merchants;
        const into = yield* merchants.named(context.owner, data.into);

        return yield* merchants.merge(context.owner, data.merchantId, into.id);
      }).pipe(
        Effect.map((merged) => ({ ok: true as const, merged })),
        Effect.catchTags({
          MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
          MerchantNameUnknown: () => refused("MERGE_INTO_UNKNOWN"),
          MerchantMergeRefused: () => refused("MERGE_INTO_ITSELF"),
        }),
      ),
    ),
  );
