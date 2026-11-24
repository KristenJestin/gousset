import { CONDITION_FIELDS, OPERATORS_OF } from "@gousset/core/rule-values";
import { RULE_FIELDS, RULE_OPERATORS } from "@gousset/ui/lib/rule-fields";
import { describe, expect, test } from "vite-plus/test";

import { conditionsOf } from "./rule-conditions";

describe("the rules' conditions, between the editor and the server", () => {
  test("the editor offers the fields and operators the server takes, in its order", () => {
    expect(RULE_FIELDS).toEqual(CONDITION_FIELDS);
    expect(RULE_OPERATORS).toEqual(OPERATORS_OF);
  });

  test("complete conditions are read as the server reads them", () => {
    expect(
      conditionsOf({
        kind: "group",
        combinator: "and",
        children: [
          { kind: "rule", field: "label", operator: "contains", value: "GREENMARKET" },
          { kind: "rule", field: "day", operator: "between", value: [3, 7] },
        ],
      }),
    ).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "contains", value: "GREENMARKET" },
        { kind: "rule", field: "day", operator: "between", value: [3, 7] },
      ],
    });
  });

  test("a condition still to fill in leaves none to save", () => {
    expect(
      conditionsOf({
        kind: "group",
        combinator: "and",
        children: [{ kind: "rule", field: "label", operator: "contains", value: "" }],
      }),
    ).toBeNull();

    expect(
      conditionsOf({
        kind: "group",
        combinator: "and",
        children: [{ kind: "rule", field: "amount", operator: "between", value: [12, null] }],
      }),
    ).toBeNull();
  });
});
