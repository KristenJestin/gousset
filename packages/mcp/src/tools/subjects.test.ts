import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Transfers,
  memoryAccountStore,
  memoryCategoryStore,
  memoryLineStore,
} from "@gousset/core";
import type { LineCategory, SubjectDetail, SubjectExpense, SubjectList } from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Caller, Runner } from "../tool";
import { listText, showText } from "./subjects";

// The subjects tool through the official client: its place, title, annotations and description,
// the refusals that come before any subject is read, and the words it answers with. What it does
// to subjects and expenses is tried end to end, on the built app and a real database
// (apps/e2e/tests/subjects-mcp.spec.ts).

const TODAY = "2026-11-26";
const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };
const writer: Caller = { ...reader, canWrite: true };

function onToday(): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    memoryAccountStore(),
    memoryLineStore(),
    memoryCategoryStore(),
    // The refusals tried here come before any subject, merchant or line is read.
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    Layer.mock(Merchants, {}),
    Layer.mock(Transfers, {}),
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
    Layer.mock(Subscriptions, {}),
    Layer.mock(MonthFacts, {}),
    Layer.mock(Expenses, {}),
    TestClock.layer(),
  );

  return (effect) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

        return yield* effect;
      }).pipe(Effect.provide(layer)),
    );
}

type Arguments = { readonly [key: string]: Schema.Json };

async function subjects(args: Arguments, caller: Caller = writer) {
  const client = await connectInProcess(goussetServer, { run: onToday() }, caller, "2025-11-25");
  const result = await client.callTool({ name: "subjects", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const ValidCall = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

/** The valid call an error ends with, read back when it is a call of `subjects`. */
function exampleOf(text: string) {
  const [, call = ""] = /\nA valid call: subjects (.+)$/.exec(text) ?? [];

  return call === "" ? undefined : Schema.decodeUnknownSync(ValidCall)(call);
}

describe("the subjects tool", () => {
  test("comes last in the fixed order, writes, and says proposals wait for the user's yes", async () => {
    const client = await connectInProcess(goussetServer, { run: onToday() }, reader, "2026-07-28");
    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "subjects");

    expect(tools.map((each) => each.name).at(-1)).toBe("subjects");
    expect(tool?.title).toBe("Subjects");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });

    const description = tool?.description ?? "";

    expect(description.length).toBeLessThan(4000);

    for (const said of [
      "counts whole in each, and once in a parent",
      "never attach one without their yes",
      '`month` `spending` with `by: "subject"`',
      "`lines` `search` with `subject`",
      "`lines` `split` with each share's `subjects`",
      "`attach_past: true`",
      "`decline: true` declines proposals, remembered",
      '{"action":"create","name":"Van","merchants":["Fuelstop"],"attach_past":true}',
      '{"action":"edit","subject":"Garden shed","parent":null}',
    ]) {
      expect(description, said).toContain(said);
    }
  });

  test("refuses every write to a token allowed to read only, and says how to get write", async () => {
    const writes = [
      ["create", { action: "create", name: "Van" }],
      ["edit", { action: "edit", subject: "Van", archived: true }],
      ["attach", { action: "attach", subject: "Van", expenses: ["an-expense"] }],
    ] as const;

    for (const [action, args] of writes) {
      const { text, isError } = await subjects(args, reader);

      expect(isError, action).toBe(true);
      expect(text, action).toContain("choose Read and write on Gousset's consent page");
    }
  });

  test("asks for what an action needs, with a valid call", async () => {
    const asked = [
      [{ action: "show" }, "show needs subject"],
      [{ action: "create" }, "create needs name"],
      [{ action: "create", name: "  " }, "create needs name"],
      [{ action: "edit" }, "edit needs subject"],
      [{ action: "edit", subject: "Van" }, "edit needs what changes"],
      [{ action: "attach", subject: "Van" }, "attach needs subject, by path or name, and expenses"],
      [
        { action: "attach", subject: "Van", expenses: ["an-expense"], remove: true, decline: true },
        "remove takes expenses off a subject; decline turns down its proposals",
      ],
      [
        { action: "create", name: "Van", value: "about 12000" },
        "value is what the subject is worth in EUR: a decimal from 0 with at most 2 decimals",
      ],
      [
        { action: "create", name: "Van", value: "12000.505" },
        "value is what the subject is worth in EUR",
      ],
      [{ action: "create", name: "Van", currency: "EUR" }, "currency goes with value"],
    ] as const;

    for (const [args, said] of asked) {
      const { text, isError } = await subjects(args);

      expect(isError, said).toBe(true);
      expect(text, said).toContain(said);
      expect(exampleOf(text), said).toBeDefined();
      expect(text.length).toBeLessThan(ERROR_LIMIT);
    }
  });

  test("refuses arguments that do not match its input, with a valid call", async () => {
    const { text, isError } = await subjects({ action: "show", subject: "Van", period: "2026" });

    expect(isError).toBe(true);
    expect(text).toContain("The arguments of subjects are not valid");
    expect(exampleOf(text)).toEqual({
      action: "show",
      subject: "House > Garden shed",
      period: "all",
    });
  });
});

const EUR = (minor: number) => ({ minor, currency: "EUR" });

const fuel: LineCategory = {
  id: "fuel",
  name: "Fuel",
  parentName: "Transport",
  kind: "expense",
  icon: null,
  color: null,
};

describe("the list in words", () => {
  test("says when the user has no subject, with the call that makes one", () => {
    expect(listText({ currency: "EUR", today: TODAY, subjects: [] })).toBe(
      'The user has no subject yet. A subject is what money is spent for (a van, a house, a trip); make one with: subjects {"action":"create","name":"Van","merchants":["Fuelstop"],"attach_past":true}',
    );
  });

  test("gives each subject by its path, its figure and its options", () => {
    const record = {
      archived: false,
      value: null,
      loan: null,
      startsOn: null,
      endsOn: null,
      accounts: [],
    };

    const list: SubjectList = {
      currency: "EUR",
      today: TODAY,
      subjects: [
        {
          ...record,
          id: "alps",
          name: "Alps 2026",
          parentId: null,
          parentName: null,
          depth: 0,
          startsOn: "2026-07-01",
          endsOn: "2026-07-14",
          headline: {
            kind: "dated",
            startsOn: "2026-07-01",
            endsOn: "2026-07-14",
            total: EUR(98_000),
            elsewhere: [{ minor: 12_000, currency: "CHF" }],
          },
        },
        {
          ...record,
          id: "house",
          name: "House",
          parentId: null,
          parentName: null,
          depth: 0,
          value: EUR(30_000_000),
          loan: { id: "mortgage", name: "Mortgage", institution: "Northbank" },
          headline: {
            kind: "monthly",
            year: 2026,
            months: 11,
            total: EUR(110_000),
            perMonth: EUR(10_000),
            elsewhere: [],
          },
        },
        {
          ...record,
          id: "shed",
          name: "Garden shed",
          parentId: "house",
          parentName: "House",
          depth: 1,
          archived: true,
          accounts: [{ id: "joint", name: "Joint account", institution: null }],
          headline: {
            kind: "monthly",
            year: 2026,
            months: 0,
            total: EUR(0),
            perMonth: null,
            elsewhere: [],
          },
        },
      ],
    };

    const text = listText(list);

    expect(text).toContain(
      "3 subject(s), in EUR, read on 2026-11-26, each by its path, a parent before its children. A parent counts its children's expenses with its own, each once; an expense on several subjects counts whole in each, so the figures never add up.",
    );
    expect(text).toContain(
      "\n- Alps 2026: from 2026-07-01 to 2026-07-14: 980.00 EUR, and 120.00 CHF in another currency, not converted in all\n",
    );
    expect(text).toContain(
      "\n- House: 1,100.00 EUR in 2026, 100.00 EUR a month over 11 month(s); worth 300,000.00 EUR; bought with the loan Mortgage (Northbank)\n",
    );
    expect(text).toContain(
      "\n- House > Garden shed (archived): 0.00 EUR in 2026; linked to Joint account\n",
    );
    expect(text).toContain(
      `One subject's costs, month by month and by category: subjects {"action":"show","subject":"Alps 2026","period":"all"}`,
    );
  });
});

const expense = (id: string, happenedOn: string, minor: number): SubjectExpense => ({
  entryId: id,
  happenedOn,
  merchant: "Fuelstop",
  label: "FUELSTOP",
  category: fuel,
  net: EUR(minor),
});

const detail: SubjectDetail = {
  id: "alps",
  name: "Alps 2026",
  parentId: null,
  parentName: null,
  archived: false,
  value: null,
  startsOn: "2026-07-01",
  endsOn: "2026-07-14",
  currency: "EUR",
  today: TODAY,
  period: { kind: "all", from: null, to: TODAY },
  total: EUR(9700),
  elsewhere: [],
  months: [{ month: "2026-07", spent: EUR(9700) }],
  categories: [{ category: fuel, spent: EUR(9700) }],
  accounts: [],
  loan: null,
  children: [{ id: "hut", name: "Mountain hut", archived: false, total: EUR(4500), elsewhere: [] }],
  expenses: {
    latest: [expense("e-2", "2026-07-09", 5200), expense("e-1", "2026-07-02", 4500)],
    count: 2,
  },
  proposals: { expenses: [expense("e-3", "2026-07-12", 3100)], more: 0 },
  merchants: [{ id: "fuelstop", name: "Fuelstop" }],
  otherRules: 1,
};

describe("a subject's page in words", () => {
  test("gives its costs, its subjects within by path, and each expense with its id", () => {
    const text = showText(detail, "Alps 2026");

    expect(text).toContain("Subject: Alps 2026. Period: all time, to 2026-11-26, in EUR.");
    expect(text).toContain(
      "Cost: 97.00 EUR, its subjects within counted with it, each expense once.",
    );
    expect(text).toContain("Dates: from 2026-07-01 to 2026-07-14.");
    expect(text).toContain("Its merchants, whose rule attaches it to their expenses: Fuelstop.");
    expect(text).toContain('1 other rule(s) attach it: rules {"action":"list"}.');
    expect(text).toContain("By month:\n- 2026-07: 97.00 EUR");
    expect(text).toContain("By category, the largest first:\n- Transport > Fuel: 97.00 EUR");
    expect(text).toContain("\n- Alps 2026 > Mountain hut: 45.00 EUR");
    expect(text).toContain(
      '\n- 2026-07-09, Fuelstop, "FUELSTOP", in Transport > Fuel: 52.00 EUR; expense: e-2',
    );
  });

  test("gives a dated subject's proposals, to confirm with the user, never attached unasked", () => {
    const text = showText(detail, "Alps 2026");

    expect(text).toContain(
      "Proposals: 1 expense(s) of its period attached neither to it nor to a subject within it, the oldest first. They are the user's to confirm: never attach one without the user's yes.",
    );
    expect(text).toContain(
      '\n- 2026-07-12, Fuelstop, "FUELSTOP", in Transport > Fuel: 31.00 EUR; expense: e-3',
    );
    expect(text).toContain(
      'Once the user says yes: subjects {"action":"attach","subject":"Alps 2026","expenses":["e-3"]}; one the user says is not for it: subjects {"action":"attach","subject":"Alps 2026","expenses":["e-3"],"decline":true}',
    );
  });

  test("gives no proposal for a subject without dates", () => {
    const text = showText({ ...detail, startsOn: null, endsOn: null, proposals: null }, "House");

    expect(text).not.toContain("Proposals");
    expect(text).not.toContain("Dates:");
  });
});
