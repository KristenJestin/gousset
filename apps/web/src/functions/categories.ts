import {
  MAX_CATEGORY_NAME,
  archiveCategory as archiveCoreCategory,
  createCategory as createCoreCategory,
  editCategory as editCoreCategory,
  listCategories,
  mergeCategory as mergeCoreCategory,
  restoreCategory as restoreCoreCategory,
} from "@gousset/core";
import type { CategoryRefused } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

// The categories page's calls (#23), on `@gousset/core`'s categories, as the MCP door's
// `categories` tool reads and changes them. A refusal comes back as a code the page translates.

/**
 * Why a change of the categories was refused, as a code for the interface to translate. A failure
 * of the server itself is thrown, not answered with a code.
 */
export type CategoryRefusalCode =
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_NAME_TAKEN"
  | "CATEGORY_THIRD_LEVEL"
  | "CATEGORY_PARENT_KIND"
  | "CATEGORY_ITSELF"
  | "CATEGORY_ARCHIVED"
  | "CATEGORY_PARENT_ARCHIVED"
  | "CATEGORY_FALLBACK"
  | "CATEGORY_NAME"
  | "CATEGORY_TOO_MANY"
  | "CATEGORY_BENCHMARK"
  | "CATEGORY_ICON"
  | "CATEGORY_POSITION";

/** A refusal's code, with the fallback it names when it is about one, as the user called it. */
const refused = (code: CategoryRefusalCode, fallback: string | null = null) =>
  Effect.succeed({ ok: false as const, code, fallback });

const REASON_CODES = {
  third_level: "CATEGORY_THIRD_LEVEL",
  parent_kind: "CATEGORY_PARENT_KIND",
  itself: "CATEGORY_ITSELF",
  archived: "CATEGORY_ARCHIVED",
  parent_archived: "CATEGORY_PARENT_ARCHIVED",
  fallback: "CATEGORY_FALLBACK",
  name: "CATEGORY_NAME",
  too_many: "CATEGORY_TOO_MANY",
  benchmark: "CATEGORY_BENCHMARK",
  icon: "CATEGORY_ICON",
  position: "CATEGORY_POSITION",
} as const satisfies { [Reason in CategoryRefused["reason"]]: CategoryRefusalCode };

/** Every refusal a change of the categories may meet, as its code. */
const REFUSALS = {
  CategoryNotFound: () => refused("CATEGORY_NOT_FOUND"),
  CategoryNameTaken: () => refused("CATEGORY_NAME_TAKEN"),
  CategoryRefused: (refusal: CategoryRefused) =>
    refused(REASON_CODES[refusal.reason], refusal.fallback ?? null),
};

/** A category's id, as the database makes them. */
export const CategoryId = Schema.String.check(
  Schema.isUUID(undefined, { message: "A category is named by its id, a UUID." }),
);

/**
 * A name as typed: the core trims it and refuses one empty or too long with a code, shown under
 * the field. The bound only keeps a page of text from the server.
 */
const Name = Schema.String.check(Schema.isMaxLength(MAX_CATEGORY_NAME * 4));

const Kind = Schema.Literals(["expense", "income"]);

/** A benchmark: the six-month average, a fixed amount in minor units, or none. */
export const BenchmarkInput = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("automatic") }),
  Schema.Struct({ mode: Schema.Literal("fixed"), minor: Schema.Int }),
  Schema.Struct({ mode: Schema.Literal("none") }),
]);

/** Every category of the user's, archived ones too, as a tree per kind with its figures. */
export const getCategories = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(listCategories(context.owner, { archived: true })));

/** Creates a category, at the top or under a top-level category of its kind. */
export const createCategory = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ kind: Kind, name: Name, parentId: Schema.NullOr(CategoryId) }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      createCoreCategory(context.owner, data).pipe(
        Effect.map((category) => ({ ok: true as const, id: category.id })),
        Effect.catchTags(REFUSALS),
      ),
    ),
  );

/** Renames a category, moves it (`parentId`, null for the top level) or sets its benchmark. */
export const editCategory = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        categoryId: CategoryId,
        name: Schema.optional(Name),
        parentId: Schema.optional(Schema.NullOr(CategoryId)),
        benchmark: Schema.optional(BenchmarkInput),
      }),
    ),
  )
  .handler(({ data, context }) => {
    const { categoryId, ...edit } = data;

    return runCore(
      editCoreCategory(context.owner, categoryId, edit).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags(REFUSALS),
      ),
    );
  });

/** Merges a category into another of its kind: its lines go there, and it is removed. */
export const mergeCategory = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ categoryId: CategoryId, intoId: CategoryId })),
  )
  .handler(({ data, context }) =>
    runCore(
      mergeCoreCategory(context.owner, data.categoryId, data.intoId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          CategoryNotFound: REFUSALS.CategoryNotFound,
          CategoryRefused: REFUSALS.CategoryRefused,
        }),
      ),
    ),
  );

const OneCategory = Schema.toStandardSchemaV1(Schema.Struct({ categoryId: CategoryId }));

/** Archives a category, a parent's children with it: they keep their lines. */
export const archiveCategory = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(OneCategory)
  .handler(({ data, context }) =>
    runCore(
      archiveCoreCategory(context.owner, data.categoryId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          CategoryNotFound: REFUSALS.CategoryNotFound,
          CategoryRefused: REFUSALS.CategoryRefused,
        }),
      ),
    ),
  );

/** Brings an archived category back, with the children archived with it. */
export const restoreCategory = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(OneCategory)
  .handler(({ data, context }) =>
    runCore(
      restoreCoreCategory(context.owner, data.categoryId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          CategoryNotFound: REFUSALS.CategoryNotFound,
          CategoryRefused: REFUSALS.CategoryRefused,
        }),
      ),
    ),
  );
