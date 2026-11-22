import { Predicate, Schema } from "effect";

type JsonObject = { readonly [key: string]: Schema.Json };

/** The keywords a listed input schema keeps: what the model needs to write a valid call. */
const KEPT = new Set(["type", "description", "enum", "const", "required", "default", "$ref"]);

/** Keywords whose value is a schema, or a list of schemas, compacted in turn. */
const NESTED = new Set(["items", "anyOf", "oneOf", "allOf"]);

function isJsonArray(value: Schema.Json): value is Schema.JsonArray {
  return Array.isArray(value);
}

function isJsonObject(value: Schema.Json): value is JsonObject {
  return Predicate.isObject(value) && !isJsonArray(value);
}

const isNullType = (value: Schema.Json) =>
  isJsonObject(value) && value["type"] === "null" && Object.keys(value).length === 1;

/**
 * The schema an optional field is listed with. Effect describes its JSON codec, which reads `null`
 * as a missing optional field (`anyOf: [T, null]`); tools decode with the schema itself, which
 * refuses `null`, so the listing shows `T` alone and `required` says it may be left out.
 */
function withoutNull(value: JsonObject) {
  const choices = value["anyOf"];

  if (choices === undefined || !isJsonArray(choices) || choices.length !== 2) {
    return value;
  }

  const [kept] = choices.filter((choice) => !isNullType(choice));

  if (kept === undefined || !isJsonObject(kept) || !choices.some(isNullType)) {
    return value;
  }

  const outer = Object.entries(value).filter(([key]) => key !== "anyOf");

  return Object.fromEntries([...Object.entries(kept), ...outer]);
}

function compactNested(value: Schema.Json): Schema.Json {
  return isJsonArray(value) ? value.map(compactSchema) : compactSchema(value);
}

/**
 * One JSON Schema, compacted for the listing: types, enums, required fields and descriptions are
 * kept; bounds, lengths, patterns and titles are left to the checks, whose errors say them.
 */
function compactSchema(value: Schema.Json): Schema.Json {
  if (!isJsonObject(value)) {
    return value;
  }

  const kept: { [key: string]: Schema.Json } = {};

  for (const [key, entry] of Object.entries(withoutNull(value))) {
    if (key === "properties" && isJsonObject(entry)) {
      kept[key] = Object.fromEntries(
        Object.entries(entry).map(([name, property]) => [name, compactSchema(property)]),
      );
    } else if (NESTED.has(key)) {
      kept[key] = compactNested(entry);
    } else if (KEPT.has(key)) {
      kept[key] = entry;
    }
  }

  return kept;
}

/** The pagination argument every tool accepts (results.ts). */
const CURSOR_PROPERTY = {
  type: "string",
  description: "Only to read on: the cursor a previous result's next call gives.",
};

/**
 * A tool's input schema as `tools/list` shows it: the Effect schema's JSON Schema, compacted,
 * with the parts it names (an `identifier` annotation) written once under `$defs`, and the
 * `cursor` that pages long results.
 */
export function listedInputSchema(input: Schema.Top): JsonObject {
  const document = Schema.toJsonSchemaDocument(input);
  const root = compactSchema(Schema.decodeUnknownSync(Schema.Json)(document.schema));

  if (!isJsonObject(root)) {
    throw new Error("A tool's input must be an object schema (a Schema.Struct).");
  }

  const declared = root["properties"];
  const properties = declared !== undefined && isJsonObject(declared) ? declared : {};

  const definitions = Object.entries(document.definitions).map(
    ([name, definition]): [string, Schema.Json] => [
      name,
      compactSchema(Schema.decodeUnknownSync(Schema.Json)(definition)),
    ],
  );

  const listed: { [key: string]: Schema.Json } = Object.fromEntries(Object.entries(root));

  listed["properties"] = Object.fromEntries([
    ...Object.entries(properties),
    ["cursor", CURSOR_PROPERTY],
  ]);

  if (definitions.length > 0) {
    listed["$defs"] = Object.fromEntries(definitions);
  }

  return listed;
}
