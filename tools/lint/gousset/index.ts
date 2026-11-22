import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/** Text a person reads: anything holding a letter, in any script. Punctuation and digits pass. */
const LETTER = /\p{L}/u;

/**
 * The attributes and object keys whose value is read or heard by a person (a toast's
 * `description`, a choice's `label`), beside the `*Label`-like names.
 */
const TEXT_NAMES = new Set([
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

const TEXT_NAME_SUFFIX = /(?:Label|Text|Title|Description|Placeholder)$/;

function isTextName(name: string): boolean {
  return TEXT_NAMES.has(name) || TEXT_NAME_SUFFIX.test(name);
}

/**
 * A component's `message` prop (`FormMessage`, `StatusMessage`) is read too; an object's
 * `message` is left alone, most often an error's, written for developers.
 */
function isTextAttribute(name: ESTree.JSXAttributeName): boolean {
  if (name.type !== "JSXIdentifier") {
    return false;
  }

  return name.name === "message" || isTextName(name.name);
}

/**
 * Whether an expression can end as written words: a string literal (its source starts with a
 * quote, unlike a number's), a template's own words, either branch of a condition, either side
 * of `&&`, `||`, `??` or of a `+`.
 */
function holdsText(node: ESTree.Node): boolean {
  switch (node.type) {
    case "Literal": {
      const raw = node.raw ?? "";

      return (raw.startsWith('"') || raw.startsWith("'")) && LETTER.test(raw);
    }
    case "TemplateLiteral": {
      return node.quasis.some((quasi) => LETTER.test(quasi.value.raw));
    }
    case "ConditionalExpression": {
      return holdsText(node.consequent) || holdsText(node.alternate);
    }
    case "LogicalExpression": {
      return holdsText(node.left) || holdsText(node.right);
    }
    case "BinaryExpression": {
      return node.operator === "+" && (holdsText(node.left) || holdsText(node.right));
    }
    default: {
      return false;
    }
  }
}

/**
 * Every text of the interface goes through the messages (`@gousset/i18n`), so that it is written
 * in English and translated: a component holds no word of its own, neither between its tags, nor
 * in an attribute someone reads (`aria-label`, `title`, `label`…), nor under such a key of an
 * object (`notify.failed({ description })`). A word held in a variable is not followed: that
 * would take the type checker's data flow, and most constants are keys or classes, not text.
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
      Property(node) {
        if (
          !node.computed &&
          node.key.type === "Identifier" &&
          isTextName(node.key.name) &&
          holdsText(node.value)
        ) {
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
