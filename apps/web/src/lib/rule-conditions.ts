import { Conditions } from "@gousset/core/rule-values";
import type { RuleConditions, RuleConditionsDraft } from "@gousset/ui/lib/rule-fields";
import { Option, Schema } from "effect";

// Between the rules' editor (packages/ui, on qnot's shape) and the server (`@gousset/core`'s
// `Conditions`): the editor's drafts are read with the server's own schema, and the server's
// conditions are drawn as they are, the type checker holding both declarations to one shape.

const decodeConditions = Schema.decodeUnknownOption(Conditions);

/** The editor's conditions once each is complete and readable; `null` while one is not. */
export function conditionsOf(draft: RuleConditionsDraft): Conditions | null {
  return Option.getOrNull(decodeConditions(draft));
}

/** One condition, what a correction proposes: the label contains `words`. */
export function proposalConditions(words: string): Conditions {
  return {
    kind: "group",
    combinator: "and",
    children: [{ kind: "rule", field: "label", operator: "contains", value: words }],
  };
}

/** The server's conditions, as the rules' components draw them. */
export function drawnConditions(conditions: Conditions): RuleConditions {
  return conditions;
}
