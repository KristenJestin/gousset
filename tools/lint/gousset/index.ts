import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/** Text a person reads: anything holding a letter, in any script. Punctuation and digits pass. */
const LETTER = /\p{L}/u;

/** The attributes whose value is read or heard by a person, beside the `*Label`-like names. */
const TEXT_ATTRIBUTES = new Set([
  "alt",
  "title",
  "label",
  "placeholder",
  "description",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);

const TEXT_ATTRIBUTE_SUFFIX = /(?:Label|Text|Title|Description|Placeholder)$/;

function isTextAttribute(name: ESTree.JSXAttributeName): boolean {
  if (name.type !== "JSXIdentifier") {
    return false;
  }

  return TEXT_ATTRIBUTES.has(name.name) || TEXT_ATTRIBUTE_SUFFIX.test(name.name);
}

/** A string literal's source (it starts with a quote, unlike a number's), or a plain template's. */
function literalText(node: ESTree.Node): string | undefined {
  if (node.type === "Literal") {
    const raw = node.raw ?? "";

    return raw.startsWith('"') || raw.startsWith("'") ? raw : undefined;
  }

  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.raw).join("");
  }

  return undefined;
}

function holdsText(node: ESTree.Node): boolean {
  const text = literalText(node);

  return text !== undefined && LETTER.test(text);
}

/**
 * Every text of the interface goes through the messages (`@gousset/i18n`), so that it is written
 * in English and translated: a component holds no word of its own, neither between its tags nor
 * in an attribute someone reads (`aria-label`, `title`, `label`…).
 */
const noTextOutsideMessages = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Text a person reads comes from the messages (`m.*()` of `@gousset/i18n`).",
    },
    messages: {
      text: 'Text outside the messages: add it to packages/i18n/messages/en.json and fr.json, then use `m.<key>()` from "@gousset/i18n/messages".',
    },
  },
  createOnce(context) {
    return {
      JSXText(node) {
        if (LETTER.test(node.value)) {
          context.report({ node, messageId: "text" });
        }
      },
      JSXExpressionContainer(node) {
        const parent = node.parent.type;
        const isChild = parent === "JSXElement" || parent === "JSXFragment";

        if (isChild && holdsText(node.expression)) {
          context.report({ node, messageId: "text" });
        }
      },
      JSXAttribute(node) {
        if (node.value === null || !isTextAttribute(node.name)) {
          return;
        }

        const value =
          node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;

        if (holdsText(value)) {
          context.report({ node, messageId: "text" });
        }
      },
    };
  },
});

/** Gousset's own lint rules, for what no upstream preset checks. */
const goussetPlugin = eslintCompatPlugin({
  meta: { name: "gousset" },
  rules: {
    "no-text-outside-messages": noTextOutsideMessages,
  },
});

export default goussetPlugin;
