import {
  LookColor,
  MAX_MERCHANTS_LISTED,
  Merchants,
  assignLineMerchant as assignCoreLineMerchant,
  lineMerchant,
  listMerchants,
  markIntermediary,
  setMerchantDefaultCategory,
  showMerchant,
} from "@gousset/core";
import type { LineMerchantRefused } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { LineId } from "@/lib/operations-search";
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
  | "MERGE_INTO_UNKNOWN"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_ARCHIVED"
  | "LINE_NOT_FOUND"
  | "NOT_INTERMEDIARY"
  | "NOT_ONE_ENTRY"
  | "INTERMEDIARY_CHOSEN"
  | "LABEL_NO_KEY"
  | "LABEL_TAKEN"
  | "LOGO_TOO_LARGE"
  | "LOGO_TYPE"
  | "LOGO_EMPTY";

/**
 * A refusal, with the merchant's name it is about when there is one (the one taken, say), and the
 * label it is about when a label is refused (#204).
 */
const refused = (code: MerchantRefusalCode, name?: string, label?: string) =>
  Effect.succeed({ ok: false as const, code, name, label });

const NAME_CODES = { blank: "NAME_BLANK", too_long: "NAME_TOO_LONG" } as const;

/** Why who was paid cannot be set on a line (#30), by its reason. */
const LINE_MERCHANT_CODES = {
  not_intermediary: "NOT_INTERMEDIARY",
  not_one_entry: "NOT_ONE_ENTRY",
  intermediary_chosen: "INTERMEDIARY_CHOSEN",
} as const satisfies { [Reason in LineMerchantRefused["reason"]]: MerchantRefusalCode };

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

/** The labels a form sends: as many as a person types, and no more. */
const Labels = Schema.Array(Typed).check(Schema.isMaxLength(100));

/** What a merchant made by hand is (#204): its colour null for the automatic one. */
const MerchantInput = Schema.Struct({
  name: Typed,
  defaultCategoryId: Schema.NullOr(MerchantId),
  intermediary: Schema.Boolean,
  color: Schema.NullOr(LookColor),
  labels: Labels,
});

/** What an edit changes (#204): a field left out stays as it is; null clears a category or colour. */
const MerchantEditInput = Schema.Struct({
  merchantId: MerchantId,
  name: Schema.optional(Typed),
  defaultCategoryId: Schema.optional(Schema.NullOr(MerchantId)),
  intermediary: Schema.optional(Schema.Boolean),
  color: Schema.optional(Schema.NullOr(LookColor)),
  /** Labels added; one comes off by moving it (`moveMerchantLabel`). */
  labels: Schema.optional(Labels),
});

/** The refusals of a merchant made or edited by hand, as codes. */
const writeRefusals = {
  MerchantNameRefused: (refusal: { readonly reason: "blank" | "too_long" }) =>
    refused(NAME_CODES[refusal.reason]),
  MerchantNameTaken: (refusal: { readonly name: string }) => refused("NAME_TAKEN", refusal.name),
  MerchantLabelRefused: (refusal: { readonly label: string }) =>
    refused("LABEL_NO_KEY", undefined, refusal.label),
  MerchantLabelTaken: (refusal: { readonly label: string; readonly name: string }) =>
    refused("LABEL_TAKEN", refusal.name, refusal.label),
  CategoryNotFound: () => refused("CATEGORY_NOT_FOUND"),
  CategoryRefused: () => refused("CATEGORY_ARCHIVED"),
};

/**
 * Makes a merchant by hand (#204): its name, default category, mark, colour and the labels that
 * name it, at once; the next imported lines whose labels clean as one of them are its. Refused
 * with a code: a name blank, too long or taken (with the merchant that has it), a label that cleans
 * to nothing (`LABEL_NO_KEY`, with the label) or names another merchant (`LABEL_TAKEN`, with the
 * label and that merchant's name), a category gone or archived.
 */
export const createMerchant = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(MerchantInput))
  .handler(({ data, context }) =>
    runCore(
      Effect.gen(function* () {
        const merchants = yield* Merchants;

        return yield* merchants.create(context.owner, {
          name: data.name,
          defaultCategoryId: data.defaultCategoryId,
          intermediary: data.intermediary,
          color: data.color,
          aliases: data.labels,
        });
      }).pipe(
        Effect.map((merchant) => ({ ok: true as const, merchant })),
        Effect.catchTags(writeRefusals),
      ),
    ),
  );

/**
 * Edits a merchant in one place (#204): what is given of its name, default category, mark and
 * colour, and labels added, at once. Refused as `createMerchant` is, and for a merchant the user
 * does not have. Its logo is the logo route's (`/api/merchants/$merchantId/logo`).
 */
export const editMerchant = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(MerchantEditInput))
  .handler(({ data, context }) =>
    runCore(
      Effect.gen(function* () {
        const merchants = yield* Merchants;

        return yield* merchants.edit(context.owner, data.merchantId, {
          name: data.name,
          defaultCategoryId: data.defaultCategoryId,
          intermediary: data.intermediary,
          color: data.color,
          addAliases: data.labels,
        });
      }).pipe(
        Effect.map((merchant) => ({ ok: true as const, merchant })),
        Effect.catchTags({
          ...writeRefusals,
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
 * Sets the category a merchant's entries go in by default, of either kind, or clears it (`null`).
 * Refused with a code: a merchant the user does not have, a category gone, or one archived.
 */
export const setMerchantCategory = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ merchantId: MerchantId, categoryId: Schema.NullOr(MerchantId) }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      setMerchantDefaultCategory(context.owner, data.merchantId, data.categoryId).pipe(
        Effect.map((category) => ({ ok: true as const, category })),
        Effect.catchTags({
          MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
          CategoryNotFound: () => refused("CATEGORY_NOT_FOUND"),
          CategoryRefused: () => refused("CATEGORY_ARCHIVED"),
        }),
      ),
    ),
  );

/**
 * Marks a merchant a payment intermediary (#30), or not: its lines' labels hide who was paid, and
 * each of them asks for its merchant. A merchant the user does not have comes back as a code.
 */
export const setMerchantIntermediary = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ merchantId: MerchantId, intermediary: Schema.Boolean }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      markIntermediary(context.owner, data.merchantId, data.intermediary).pipe(
        Effect.map((merchant) => ({ ok: true as const, merchant })),
        Effect.catchTags({ MerchantNotFound: () => refused("MERCHANT_NOT_FOUND") }),
      ),
    ),
  );

/**
 * Who a line paid, the payment intermediary its label names, and whether who was paid is asked of
 * the user (#30). A line the user does not have comes back as a code.
 */
export const getLineMerchant = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      lineMerchant(context.owner, data.lineId).pipe(
        Effect.map((merchant) => ({ ok: true as const, merchant })),
        Effect.catchTags({ LineNotFound: () => refused("LINE_NOT_FOUND") }),
      ),
    ),
  );

/**
 * Sets who was paid on a line paid through an intermediary (#30): the merchant named `name` (any
 * case), made when none has it; the entry goes in its default category when it was not classified
 * yet. Refused with a code: a line the user does not have, one whose label names no intermediary,
 * one that is no single entry of its own, a merchant that is an intermediary itself, a blank name
 * or one too long.
 */
export const assignLineMerchant = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, name: Typed })))
  .handler(({ data, context }) =>
    runCore(
      assignCoreLineMerchant(context.owner, data.lineId, data.name).pipe(
        Effect.map((assigned) => ({ ok: true as const, assigned })),
        Effect.catchTags({
          LineNotFound: () => refused("LINE_NOT_FOUND"),
          // An intermediary chosen is named as typed, for the message to say which.
          LineMerchantRefused: (refusal) =>
            refused(LINE_MERCHANT_CODES[refusal.reason], data.name.trim()),
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
