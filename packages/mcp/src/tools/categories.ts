import {
  archiveCategory,
  categoryNamed,
  createCategory,
  editCategory,
  listCategories,
  mergeCategory,
  restoreCategory,
} from "@gousset/core";
import type {
  Benchmark,
  CategoryNode,
  CategoryRecord,
  CategoryRefused,
  CategoryStore,
  CategoryTree,
  EntryKind,
  LineCategory,
  Money,
} from "@gousset/core";
import { minorDigits } from "@gousset/import";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import type { Caller } from "../tool";
import { amount } from "./accounts";

/**
 * The currency fixed benchmarks are written in: the user's own (`auth_user.currency`, v0.3,
 * docs/data-model.md), as the door read it with the caller. The one place the tools read it.
 */
export function benchmarkCurrency(caller: Caller): string {
  return caller.currency;
}

const Kind = Schema.Literals(["expense", "income"]);

const CategoriesInput = Schema.Struct({
  action: Schema.Literals(["list", "create", "edit", "merge", "archive"]).annotate({
    description:
      "list: every category, two levels per kind. create: a new one. edit: rename, move or change its benchmark. merge: move every entry of one into another, then delete it. archive: hide one from choices, keeping its history (restore: true brings it back).",
  }),
  kind: Schema.optional(
    Kind.annotate({
      description:
        "expense or income. create: the new category's (its parent's, or expense, if left out). list: that kind only. Otherwise: tells apart an expense and an income category of the same name (\"Other\").",
    }),
  ),
  category: Schema.optional(
    Schema.String.annotate({
      description:
        'edit, merge, archive: the category, by its name or "Parent > Child", as list writes it (any case).',
    }),
  ),
  name: Schema.optional(
    Schema.String.annotate({
      description:
        "create: the new category's name. edit: its new name. 1 to 100 characters, no >.",
    }),
  ),
  parent: Schema.optional(
    Schema.String.annotate({
      description:
        "create, edit: the top-level category to go under, by name. Left out on create: a top-level category.",
    }),
  ),
  top_level: Schema.optional(
    Schema.Boolean.annotate({ description: "edit: true moves a child to the top level." }),
  ),
  into: Schema.optional(
    Schema.String.annotate({
      description: 'merge: the category that takes every entry, by name or "Parent > Child".',
    }),
  ),
  benchmark: Schema.optional(
    Schema.String.annotate({
      description:
        'create, edit: "automatic" (the six-month average; the default), "none", or a fixed monthly amount in the user\'s currency, a decimal ("450", "85.50").',
    }),
  ),
  archived: Schema.optional(
    Schema.Boolean.annotate({ description: "list: true adds the archived categories, marked." }),
  ),
  restore: Schema.optional(
    Schema.Boolean.annotate({ description: "archive: true brings an archived category back." }),
  ),
});

type CategoriesInput = typeof CategoriesInput.Type;

type CategoriesCall = typeof CategoriesInput.Encoded;

const DESCRIPTION = `The user's categories, on two levels (a top-level category and its children), one tree for expenses and one for income; every expense has exactly one. \`list\` gives both trees with each category's entries, benchmark and monthly average over the six full months before this one, marks the fallback ("Other", where unclassified lines go) and, with \`archived: true\`, adds the archived ones. \`create\` makes one; \`edit\` renames it, moves it under another top-level category (\`parent\`) or to the top (\`top_level: true\`), or sets its benchmark; \`merge\` moves every entry of \`category\`, and every merchant's default category on it, into \`into\` (its children go under \`into\`, or into \`into\`'s child of the same name) and deletes it; \`archive\` hides it from choices while its entries keep it, \`restore: true\` brings it back. To put a line in a category, use \`lines\` with \`classify\`; for where the money went in a month, \`month\`.

Name a category as \`list\` writes it (any case): a name alone is the top-level category of that name, else the one child of that name; "Parent > Child" names a child. Add \`kind\` when an expense and an income category share it. A benchmark is "automatic", "none", or a decimal amount a month in the user's currency.

Refused, with what to do: a third level (a category under a child, or one with children under a parent), a parent or merge target of the other kind, a name its siblings already have or holding ">", archiving or merging away the fallback, an archived parent or target, a benchmark that is no decimal from 0. Every action but list needs the write scope.

Examples: {"action":"list"} · {"action":"create","name":"Water","parent":"Housing"} · {"action":"edit","category":"Groceries > Bakery","parent":"Eating out","benchmark":"40"} · {"action":"merge","category":"Market","into":"Groceries > Supermarket"} · {"action":"archive","category":"Family","restore":true}`;

const call = (input: CategoriesCall) => `categories ${JSON.stringify(input)}`;

const LIST = call({ action: "list" });

const refusal = (message: string, example: string) =>
  Effect.fail(new ToolRefusal({ message, example }));

/** "Parent > Child" for a child, its name for a top-level category: how a person names it. */
export function pathText(category: LineCategory): string {
  return category.parentName === null ? category.name : `${category.parentName} > ${category.name}`;
}

/** A sum per currency, never converted. */
const moneyText = (money: ReadonlyArray<Money>) => money.map(amount).join(" + ");

function benchmarkText(benchmark: Benchmark, currency: string): string {
  switch (benchmark.mode) {
    case "automatic": {
      return "benchmark: the six-month average";
    }

    case "fixed": {
      return `benchmark: ${amount({ minor: benchmark.minor, currency })} a month`;
    }

    case "none": {
      return "no benchmark";
    }
  }
}

/** A decimal from 0, with at most the currency's minor digits; 11 digits of units at most. */
const BENCHMARK_AMOUNT = /^(\d{1,11})(?:[.,](\d+))?$/;

/** The benchmark a caller writes, or undefined when it is none of the three forms. */
function benchmarkOf(written: string, currency: string): Benchmark | undefined {
  const text = written.trim().toLowerCase();

  if (text === "automatic" || text === "none") {
    return { mode: text };
  }

  const match = BENCHMARK_AMOUNT.exec(text);
  const digits = minorDigits(currency);
  const fraction = match?.[2] ?? "";

  if (match === null || fraction.length > digits) {
    return undefined;
  }

  return { mode: "fixed", minor: Number(`${match[1] ?? "0"}${fraction.padEnd(digits, "0")}`) };
}

/** The benchmark of a create or an edit, or the refusal to give; undefined when left out. */
function benchmarkFrom(input: CategoriesInput, currency: string) {
  const written = input.benchmark;

  if (written === undefined) {
    return Effect.succeed(undefined);
  }

  const benchmark = benchmarkOf(written, currency);
  const digits = minorDigits(currency);

  return benchmark === undefined
    ? refusal(
        `benchmark is "automatic" (the six-month average), "none", or a fixed amount a month in ${currency}, a decimal from 0 with at most ${digits} decimals ("450"${digits > 0 ? `, "85.${"5".padEnd(digits, "0")}"` : ""}), without sign nor currency.`,
        call({ ...input, benchmark: "450" }),
      )
    : Effect.succeed(benchmark);
}

/**
 * The category a person names, or a refusal that says how to name it; `retry` writes the same
 * call with another name (and kind), for the example.
 */
export function namedCategory(
  owner: string,
  name: string,
  kind: EntryKind | undefined,
  retry: (name: string, kind: EntryKind | undefined) => string,
) {
  return categoryNamed(owner, name.trim(), kind).pipe(
    Effect.catchTags({
      CategoryNameUnknown: (unknown) =>
        refusal(
          unknown.categories.length === 0
            ? `The user has no ${kind === undefined ? "" : `${kind} `}category yet: create one first.`
            : `No ${kind === undefined ? "" : `${kind} `}category of the user's is named "${unknown.name}". Their categories: ${unknown.categories.join(", ")}. Name one as categories list writes it: its name, or "Parent > Child".`,
          LIST,
        ),
      CategoryNameAmbiguous: (ambiguous) => {
        // Each path names one category of its kind: the first, with its kind, is a valid retry.
        const [first] = ambiguous.matches;
        const kinds = new Set(ambiguous.matches.map((match) => match.kind));

        return refusal(
          kinds.size === 1
            ? `Several categories of the user's are named "${ambiguous.name}": ${ambiguous.matches.map((match) => match.path).join(", ")}. Name one by its path, "Parent > Child".`
            : `An expense and an income category of the user's are both named "${ambiguous.name}": ${ambiguous.matches.map((match) => `${match.path} (${match.kind})`).join(", ")}. Add kind, expense or income, to say which, and name it as written here.`,
          retry(first?.path ?? ambiguous.name, first?.kind ?? kind),
        );
      },
      QueryFailed: Effect.die,
    }),
  );
}

/**
 * A fallback archived or merged away, itself or with its parent: named as the user called it, with
 * the call that moves it to the top level when it is a child.
 */
function fallbackRefusal(owner: string, name: string, kind: EntryKind | undefined) {
  return Effect.gen(function* () {
    const tree = yield* listCategories(owner, { archived: true });
    const kinds: ReadonlyArray<EntryKind> = kind === undefined ? ["expense", "income"] : [kind];

    const found = kinds.flatMap((each) =>
      tree[each].flatMap((top) =>
        [top, ...top.children].flatMap((node) =>
          node.fallback && node.name === name ? [{ node, parent: top === node ? null : top }] : [],
        ),
      ),
    );

    const [first] = found;
    const of = first === undefined ? "" : ` ${first.node.kind}`;

    const where =
      first === undefined || first.parent === null
        ? ""
        : ` It is under "${first.parent.name}": move it to the top level first, then archive or merge that parent.`;

    return yield* refusal(
      `"${name}" is the user's${of} fallback, where unclassified lines go: it cannot be archived nor merged away, nor go with a parent archived or merged into a category that has a child of its name.${where} Merge other categories into it instead.`,
      first === undefined || first.parent === null
        ? LIST
        : call({
            action: "edit",
            category: `${first.parent.name} > ${first.node.name}`,
            kind: first.node.kind,
            top_level: true,
          }),
    );
  }).pipe(Effect.catchTag("QueryFailed", Effect.die));
}

/** A category's path as a person writes it, read from the user's categories, archived ones too. */
function pathOf(owner: string, category: CategoryRecord) {
  return listCategories(owner, { archived: true }).pipe(
    Effect.map((tree) => {
      const parent = tree[category.kind].find((top) => top.id === category.parentId);

      return pathText({ ...category, parentName: parent?.name ?? null });
    }),
  );
}

/** What a refused change of the categories names: the categories the call gave, as written. */
type Named = {
  readonly category?: string;
  readonly parent?: string;
  readonly into?: string;
  readonly name?: string;
};

/** A refusal of the core's rules, in words, with a call that does what is allowed. */
function reasonRefusal(
  owner: string,
  refused: CategoryRefused,
  input: CategoriesInput,
  named: Named,
  target: CategoryRecord | undefined,
) {
  const { reason } = refused;

  switch (reason) {
    case "third_level": {
      return Effect.gen(function* () {
        // The top-level category above the one the caller chose: where the category may go.
        const top =
          target === undefined || target.parentId === null
            ? undefined
            : (yield* listCategories(owner, { archived: true }))[target.kind].find(
                (each) => each.id === target.parentId,
              );

        return yield* refusal(
          `Categories have two levels: a category goes at the top or under a top-level category, and one with children stays at the top. ${target === undefined || target.parentId === null ? `"${named.category ?? ""}" has children of its own.` : `"${named.parent ?? named.into ?? ""}" is a child, under "${top?.name ?? "another category"}".`} Choose a top-level category.`,
          top === undefined
            ? LIST
            : call(
                input.action === "merge"
                  ? { ...input, into: top.name }
                  : { ...input, parent: top.name },
              ),
        );
      }).pipe(Effect.catchTag("QueryFailed", Effect.die));
    }

    case "parent_kind": {
      return refusal(
        "A category goes under, or merges into, a category of its own kind: expense with expense, income with income. Choose one of the same kind, as categories list gives them.",
        LIST,
      );
    }

    case "itself": {
      return refusal("A category cannot go under itself, nor merge into itself.", LIST);
    }

    case "archived": {
      const which = named.parent ?? named.into ?? named.category ?? "";

      return refusal(
        `"${which}" is archived: it can no longer be chosen. Restore it first, or choose a category in use.`,
        call({ action: "archive", category: which, kind: target?.kind, restore: true }),
      );
    }

    case "parent_archived": {
      return refusal(
        `The parent of "${named.category ?? ""}" is archived: restore the parent, which brings back the children archived with it.`,
        LIST,
      );
    }

    case "fallback": {
      return fallbackRefusal(owner, refused.fallback ?? "", target?.kind);
    }

    case "name": {
      const fixed = (named.name ?? "").replaceAll(">", "-").trim().slice(0, 100);

      return refusal(
        'A category\'s name has 1 to 100 characters and no ">", which separates a parent from a child.',
        call({ ...input, name: fixed === "" ? "Water" : fixed }),
      );
    }

    case "too_many": {
      return refusal(
        "The user has 300 categories, archived ones included: the most Gousset keeps. Merge some first.",
        LIST,
      );
    }

    case "benchmark": {
      return refusal(
        'benchmark is "automatic", "none", or a decimal amount from 0.',
        call({ ...input, benchmark: "automatic" }),
      );
    }

    // The tool sets neither an icon nor a position.
    case "icon":
    case "position": {
      return Effect.die(
        new Error(`A category refused for its ${reason}, which the tool never sets.`),
      );
    }
  }
}

/** A create or an edit gives a name its siblings have. */
const nameTaken = (taken: { readonly name: string }) =>
  refusal(
    `A category of the same kind and level already has the name "${taken.name}" (any case). Choose another name, or merge into that one.`,
    LIST,
  );

/** The refusals every change of the categories may meet, in words. */
function changeRefusals(
  owner: string,
  input: CategoriesInput,
  named: Named,
  target: () => CategoryRecord | undefined,
) {
  return {
    CategoryRefused: (refused: CategoryRefused) =>
      reasonRefusal(owner, refused, input, named, target()),
    // Found by name a moment before: changed in between, as good as unknown.
    CategoryNotFound: () =>
      refusal("A category this call names is gone: list the categories again.", LIST),
  };
}

function nodeText(node: CategoryNode, currency: string, indent: string): string {
  const marks = [
    ...(node.fallback ? ["fallback: unclassified lines go here"] : []),
    ...(node.archivedAt === null ? [] : [`archived on ${node.archivedAt.slice(0, 10)}`]),
  ];

  const average =
    node.average.length === 0 ? "nothing in those months" : `${moneyText(node.average)} a month`;

  const withChildren =
    node.children.length === 0
      ? ""
      : node.averageWithChildren.length === 0
        ? ", with its children nothing"
        : `, with its children ${moneyText(node.averageWithChildren)}`;

  const marked = marks.length === 0 ? "" : ` (${marks.join("; ")})`;

  return `${indent}- ${node.name}${marked}: ${node.entries} entr${node.entries === 1 ? "y" : "ies"}; ${benchmarkText(node.benchmark, currency)}; average ${average}${withChildren}`;
}

function treeText(title: string, nodes: ReadonlyArray<CategoryNode>, currency: string): string {
  if (nodes.length === 0) {
    return `${title}: none.`;
  }

  return [
    `${title}:`,
    ...nodes.flatMap((top) => [
      nodeText(top, currency, ""),
      ...top.children.map((child) => nodeText(child, currency, "  ")),
    ]),
  ].join("\n");
}

/** The categories page, in Gousset's words: each kind's tree, with its figures. */
function listText(tree: CategoryTree, input: CategoriesInput, currency: string): string {
  const kinds: ReadonlyArray<EntryKind> =
    input.kind === undefined ? ["expense", "income"] : [input.kind];

  const archived =
    input.archived === true
      ? "Archived categories are included, marked."
      : 'Archived categories are left out: add "archived":true to see them.';

  return [
    `The user's categories, on two levels (children indented under their parent). Each: its entries (all time), its benchmark, and its monthly average from ${tree.averageFrom} to ${tree.averageTo}, per currency. Name a child "Parent > Child" when its name alone is shared. ${archived}`,
    ...kinds.map((kind) =>
      treeText(
        kind === "expense" ? "Expense categories" : "Income categories",
        tree[kind],
        currency,
      ),
    ),
  ].join("\n\n");
}

const missing = (message: string, example: CategoriesCall) => refusal(message, call(example));

function listAction(caller: Caller, input: CategoriesInput) {
  return listCategories(caller.userId, { archived: input.archived === true }).pipe(
    Effect.map((tree) => listText(tree, input, benchmarkCurrency(caller))),
    Effect.catchTag("QueryFailed", Effect.die),
  );
}

function createAction(caller: Caller, input: CategoriesInput) {
  const { name } = input;
  const owner = caller.userId;
  const currency = benchmarkCurrency(caller);

  if (name === undefined) {
    return missing("create needs the new category's name.", {
      action: "create",
      name: "Water",
      parent: "Housing",
    });
  }

  let parent: CategoryRecord | undefined;

  return Effect.gen(function* () {
    const benchmark = yield* benchmarkFrom(input, currency);

    parent =
      input.parent === undefined
        ? undefined
        : yield* namedCategory(owner, input.parent, input.kind, (other, kind) =>
            call({ ...input, parent: other, kind }),
          );

    const kind = input.kind ?? parent?.kind ?? "expense";
    const made = yield* createCategory(owner, { kind, name, parentId: parent?.id, benchmark });
    const path = pathText({ ...made, parentName: parent?.name ?? null });

    return `Created the ${kind} category "${path}", ${benchmarkText(made.benchmark, currency)}. Lines are put in it with lines classify.`;
  }).pipe(
    Effect.catchTags({
      ...changeRefusals(owner, input, { parent: input.parent, name }, () => parent),
      CategoryNameTaken: nameTaken,
      QueryFailed: Effect.die,
    }),
  );
}

function editAction(caller: Caller, input: CategoriesInput) {
  const { category } = input;
  const owner = caller.userId;
  const currency = benchmarkCurrency(caller);

  if (category === undefined) {
    return missing("edit needs the category, by its name as list writes it.", {
      action: "edit",
      category: "Groceries > Bakery",
      name: "Bakeries",
    });
  }

  if (input.parent !== undefined && input.top_level === true) {
    return missing(
      "A category goes under a parent or to the top level, not both: give parent or top_level.",
      { ...input, top_level: undefined },
    );
  }

  if (
    input.name === undefined &&
    input.parent === undefined &&
    input.top_level !== true &&
    input.benchmark === undefined
  ) {
    return missing(
      "edit changes the name, the place (parent or top_level) or the benchmark: give one.",
      {
        action: "edit",
        category,
        benchmark: "automatic",
      },
    );
  }

  let found: CategoryRecord | undefined;
  let parent: CategoryRecord | undefined;

  return Effect.gen(function* () {
    const benchmark = yield* benchmarkFrom(input, currency);

    found = yield* namedCategory(owner, category, input.kind, (other, kind) =>
      call({ ...input, category: other, kind }),
    );

    const kind = found.kind;

    parent =
      input.parent === undefined
        ? undefined
        : yield* namedCategory(owner, input.parent, kind, (other) =>
            call({ ...input, parent: other }),
          );

    const before = yield* pathOf(owner, found);

    const edited = yield* editCategory(owner, found.id, {
      name: input.name,
      parentId: input.top_level === true ? null : parent?.id,
      benchmark,
    });

    const after = yield* pathOf(owner, edited);
    const saved = before === after ? `"${after}" is saved` : `"${before}" is now "${after}"`;

    return `${saved}, ${kind} category, ${benchmarkText(edited.benchmark, currency)}.`;
  }).pipe(
    Effect.catchTags({
      ...changeRefusals(
        owner,
        input,
        { category, parent: input.parent, name: input.name },
        () => parent ?? found,
      ),
      CategoryNameTaken: nameTaken,
      QueryFailed: Effect.die,
    }),
  );
}

function mergeAction(caller: Caller, input: CategoriesInput) {
  const { category, into } = input;
  const owner = caller.userId;

  if (category === undefined || into === undefined) {
    return missing(
      "merge needs the category to merge away (category) and the one that takes its entries (into).",
      {
        action: "merge",
        category: "Market",
        into: "Groceries > Supermarket",
      },
    );
  }

  let merged: CategoryRecord | undefined;
  let target: CategoryRecord | undefined;

  return Effect.gen(function* () {
    merged = yield* namedCategory(owner, category, input.kind, (other, kind) =>
      call({ ...input, category: other, kind }),
    );

    target = yield* namedCategory(owner, into, merged.kind, (other) =>
      call({ ...input, into: other }),
    );

    const before = yield* pathOf(owner, merged);
    const done = yield* mergeCategory(owner, merged.id, target.id);
    const after = yield* pathOf(owner, done.into);

    const children = [
      ...(done.childrenMoved === 0
        ? []
        : [`${done.childrenMoved} of its children went under "${after}" as they were.`]),
      ...(done.childrenMerged === 0
        ? []
        : [
            `${done.childrenMerged} of its children merged into "${after}"'s child of the same name.`,
          ]),
    ];

    return [
      `Merged "${before}" into "${after}": every entry of "${before}" is now in "${after}", and "${before}" is deleted.`,
      ...children,
    ].join(" ");
  }).pipe(
    Effect.catchTags({
      ...changeRefusals(owner, input, { category, into }, () => target ?? merged),
      QueryFailed: Effect.die,
    }),
  );
}

function archiveAction(caller: Caller, input: CategoriesInput) {
  const { category } = input;
  const owner = caller.userId;

  if (category === undefined) {
    return missing("archive needs the category, by its name as list writes it.", {
      action: "archive",
      category: "Family",
    });
  }

  let found: CategoryRecord | undefined;

  return Effect.gen(function* () {
    found = yield* namedCategory(owner, category, input.kind, (other, kind) =>
      call({ ...input, category: other, kind }),
    );

    const path = yield* pathOf(owner, found);

    if (input.restore === true) {
      yield* restoreCategory(owner, found.id);

      return `Restored "${path}": it can be chosen again${found.parentId === null ? ", with its children archived with it" : ""}.`;
    }

    yield* archiveCategory(owner, found.id);

    return `Archived "${path}"${found.parentId === null ? " and its children" : ""}: no longer offered as a choice. Its entries keep it, and categories list shows it with "archived":true. Bring it back with: ${call({ action: "archive", category: path, kind: found.kind, restore: true })}`;
  }).pipe(
    Effect.catchTags({
      ...changeRefusals(owner, input, { category }, () => found),
      QueryFailed: Effect.die,
    }),
  );
}

/** The categories family (docs/mcp.md, "Tools"): list reads, every other action writes. */
export const categoriesTool = defineTool<CategoriesInput, CategoriesCall, CategoryStore>({
  name: "categories",
  title: "Categories",
  description: DESCRIPTION,
  // A repeat changes nothing more: the same name is refused, a merged category is gone, an
  // archived one stays archived.
  idempotent: true,
  input: CategoriesInput,
  example: { action: "create", name: "Water", parent: "Housing" },
  access: { list: "read", create: "write", edit: "write", merge: "write", archive: "write" },
  run: (input, caller) => {
    switch (input.action) {
      case "list": {
        return listAction(caller, input);
      }

      case "create": {
        return createAction(caller, input);
      }

      case "edit": {
        return editAction(caller, input);
      }

      case "merge": {
        return mergeAction(caller, input);
      }

      case "archive": {
        return archiveAction(caller, input);
      }
    }
  },
});
