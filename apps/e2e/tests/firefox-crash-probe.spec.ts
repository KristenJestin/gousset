import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { freemem, totalmem } from "node:os";

import type { Browser, BrowserContext, BrowserType, Page } from "@playwright/test";
import { createRule } from "@gousset/core";
import { category, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import {
  addUser,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// A probe, not a scenario, removed before the pull request is ready: Firefox's content process
// crashes ("Page crashed") in the axe scan that ends rules.spec's correction scenario, a rule's
// sheet open. Each variant brings a page of its own browser to a state, then runs that scan ten
// times, saying after each run the page's activity (DOM mutations, React commits, elements), the
// content processes' memory, and on a crash the browser's last output and the kernel's log.

const TODAY = "2026-11-15";
const RUNS = 10;

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(async ({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** Counts React's commits and the DOM's mutations, by kind and by target, from the first script. */
const INSTRUMENT = `(() => {
  const probe = { commits: 0, records: 0, kinds: {}, targets: {} };
  window.__probe = probe;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    isDisabled: false,
    inject() { return 1; },
    onCommitFiberRoot() { probe.commits += 1; },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    setStrictMode() {},
    checkDCE() {},
  };
  const describe = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return "?";
    const own = el.getAttribute("data-slot");
    const around = el.parentElement ? el.parentElement.closest("[data-slot]") : null;
    return el.tagName.toLowerCase() + (own ? "[" + own + "]" : "") +
      (around ? " in " + around.getAttribute("data-slot") : "");
  };
  new MutationObserver((records) => {
    for (const record of records) {
      probe.records += 1;
      const kind = record.type + (record.attributeName ? ":" + record.attributeName : "");
      probe.kinds[kind] = (probe.kinds[kind] || 0) + 1;
      const target = describe(record.target);
      probe.targets[target] = (probe.targets[target] || 0) + 1;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})();`;

const TAKE = `(() => {
  const probe = window.__probe;
  const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([key, count]) => key + "=" + count).join(", ");
  const elements = document.getElementsByTagName("*").length;
  if (!probe) return { commits: -1, records: -1, kinds: "", targets: "", elements };
  const out = { commits: probe.commits, records: probe.records, kinds: top(probe.kinds),
    targets: top(probe.targets), elements };
  probe.commits = 0; probe.records = 0; probe.kinds = {}; probe.targets = {};
  return out;
})()`;

const Activity = Schema.Struct({
  commits: Schema.Number,
  records: Schema.Number,
  kinds: Schema.String,
  targets: Schema.String,
  elements: Schema.Number,
});

async function activity(page: Page): Promise<string> {
  const read = Schema.decodeUnknownSync(Activity)(await page.evaluate(TAKE));

  return `commits=${read.commits} mutations=${read.records} elements=${read.elements} kinds[${read.kinds}] targets[${read.targets}]`;
}

/** The RSS of every Firefox process on the machine, the largest first, and the free memory. */
function memory(): string {
  const processes: Array<{ name: string; rss: number }> = [];

  for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const name = /^Name:\s+(.*)$/m.exec(status)?.[1] ?? "";

      if (/Web Co|firefox|Isolated|RDD|Socket|Utility|WebExt|Privileged/i.test(name)) {
        processes.push({ name, rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) });
      }
    } catch {
      // A process that ended while read.
    }
  }

  processes.sort((a, b) => b.rss - a.rss);

  const top = processes
    .slice(0, 4)
    .map((each) => `${each.name}:${Math.round(each.rss / 1024)}M`)
    .join(" ");

  return `free=${Math.round(freemem() / 1048576)}M/${Math.round(totalmem() / 1048576)}M firefox[${top}]`;
}

/** The kernel's lines about a process killed or faulting, which say how the content process died. */
function kernelLog(): string {
  for (const command of [
    ["dmesg", "-T"],
    ["sudo", "-n", "dmesg", "-T"],
  ]) {
    try {
      const [program = "dmesg", ...args] = command;
      const text = execFileSync(program, args, { encoding: "utf8", timeout: 10_000 });

      return text
        .split("\n")
        .filter((line) =>
          /segfault|general protection|trap|oom|out of memory|killed process|web co|isolated|firefox/i.test(
            line,
          ),
        )
        .slice(-20)
        .join("\n");
    } catch (error) {
      console.log(
        `PROBE ${command.join(" ")} failed: ${error instanceof Error ? error.message.split("\n")[0] : "?"}`,
      );
    }
  }

  return "(no kernel log)";
}

/** A Firefox of the test's own, its output kept so that a crash can be read. */
async function loggedFirefox(
  playwright: { firefox: BrowserType },
  lines: Array<string>,
): Promise<Browser> {
  return playwright.firefox.launch({
    logger: {
      isEnabled: (name: string) => name === "browser",
      log: (_name: string, _severity: string, message: string | Error) => {
        lines.push(`${message}`);

        if (lines.length > 400) {
          lines.splice(0, lines.length - 400);
        }
      },
    },
  });
}

/** A user of the probe's own, and its owner id. */
async function personFor(app: { baseURL: string }, admin: TestUser, local: string) {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));

  return { person, owner: await data.ownerOf(person.email) };
}

async function expenseLines(owner: string, labels: ReadonlyArray<string>): Promise<Array<string>> {
  const accountId = await imports.createAccount(owner, `Account of ${labels[0] ?? "lines"}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: labels.map((label, index) => ({
        bookedOn: `2026-10-${String(index + 1).padStart(2, "0")}`,
        amountMinor: -1250 - index * 100,
        label,
        reference: `E2E-PROBE-${index}`,
      })),
    }),
  );

  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, label: statementLine.label })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn)),
  );

  return labels.map((label) => lines.find((line) => line.label === label)?.id ?? "");
}

async function leisureOf(owner: string): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: category.id })
      .from(category)
      .where(
        and(eq(category.name, "Leisure"), eq(category.kind, "expense"), isNull(category.parentId)),
      ),
  );

  return found?.id ?? "";
}

async function contextFor(
  browser: Browser,
  baseURL: string,
  viewport: { width: number; height: number },
  videos: string,
  instrumented: boolean,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport,
    locale: "en-US",
    timezoneId: "Europe/Paris",
    recordVideo: { dir: videos },
  });

  if (instrumented) {
    await context.addInitScript(INSTRUMENT);
  }

  return context;
}

/** rules.spec's correction scenario, to its end: the rule's sheet open on the rules' screen. */
async function correctionScenario(page: Page, person: TestUser, owner: string, word: string) {
  const [first] = await expenseLines(owner, [
    `CB E2E ${word} CAFE 01/10`,
    `CB E2E ${word} CAFE 08/10`,
    `CB E2E ${word} CAFE 15/10`,
  ]);

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, `/operations?line=${first}`);

  const picker = page
    .locator('[data-slot="line-category"]')
    .getByRole("combobox", { name: "Category" });

  await expect(picker).toHaveValue("Other");
  await picker.fill("");
  await picker.pressSequentially("Leisure");
  await page.getByRole("option", { name: "Leisure", exact: true }).click();

  const proposal = page.getByRole("dialog", { name: "Make it a rule?" });

  await proposal.getByRole("button", { name: "Create the rule" }).click();
  await expect(proposal).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByText("2 lines changed"),
  ).toBeVisible();

  await visit(page, "/settings/rules");
  await page.getByRole("button", { name: `label contains “${word} CAFE”`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rule 1" })).toContainText(
    "while correcting a line",
  );
}

/** A rule made beside the page (#134's probe), its sheet open: no correction, no job. */
async function ruleMadeBeside(page: Page, person: TestUser, owner: string, word: string) {
  await expenseLines(owner, [`CB E2E ${word} CAFE 01/10`]);
  await Effect.runPromise(
    createRule(owner, {
      conditions: {
        kind: "group",
        combinator: "and",
        children: [{ kind: "rule", field: "label", operator: "contains", value: `${word} CAFE` }],
      },
      merchantId: null,
      categoryId: await leisureOf(owner),
      createdFrom: "correction",
    }).pipe(Effect.provide(data.layer)),
  );
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, "/settings/rules");
  await page.getByRole("button", { name: `label contains “${word} CAFE”`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rule 1" })).toContainText(
    "while correcting a line",
  );
}

type Variant = {
  name: string;
  instrumented: boolean;
  reach: (page: Page, person: TestUser, owner: string, word: string) => Promise<void>;
  /** After reaching the state, before the scans. */
  then?: (page: Page) => Promise<void>;
};

const VARIANTS: ReadonlyArray<Variant> = [
  { name: "scenario-instrumented", instrumented: true, reach: correctionScenario },
  { name: "scenario-bare", instrumented: false, reach: correctionScenario },
  {
    name: "scenario-sheet-closed",
    instrumented: true,
    reach: correctionScenario,
    then: async (page) => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Rule 1" })).toBeHidden();
    },
  },
  { name: "beside-instrumented", instrumented: true, reach: ruleMadeBeside },
];

for (const [index, variant] of VARIANTS.entries()) {
  test(`probe: ${variant.name}`, async ({ app, user, playwright }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("firefox"), "Firefox only.");
    test.setTimeout(900_000);

    const tag = `PROBE ${testInfo.project.name} ${variant.name}`;
    const lines: Array<string> = [];
    const browser = await loggedFirefox(playwright, lines);
    const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
    const word = `PROBE${index}${testInfo.project.name.endsWith("phone") ? "P" : "D"}`;
    const crashes: Array<string> = [];

    try {
      const { person, owner } = await personFor(app, user, `probe-${index}`);

      const context = await contextFor(
        browser,
        app.baseURL,
        viewport,
        testInfo.outputPath("videos"),
        variant.instrumented,
      );

      const page = await context.newPage();

      page.on("crash", () => {
        console.log(`${tag}: crash event, ${memory()}`);
      });

      await variant.reach(page, person, owner, word);
      await variant.then?.(page);

      if (variant.instrumented) {
        await activity(page);
        await page.waitForTimeout(5000);
        console.log(`${tag} idle 5 s: ${await activity(page)} ${memory()}`);
      }

      for (let run = 1; run <= RUNS; run++) {
        const started = Date.now();

        try {
          await expectAccessible(page);
          await page.evaluate("document.title");

          const measured = variant.instrumented ? await activity(page) : "";

          console.log(
            `${tag} run ${run}: alive ${Date.now() - started} ms ${measured} ${memory()}`,
          );
        } catch (error) {
          const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : "?";

          crashes.push(`run ${run}: ${message}`);
          console.log(
            `${tag} run ${run}: FAILED after ${Date.now() - started} ms: ${message} ${memory()}`,
          );
          console.log(`${tag} browser output (last 60 lines):\n${lines.slice(-60).join("\n")}`);
          console.log(`${tag} kernel:\n${kernelLog()}`);

          break;
        }
      }

      await context.close().catch(() => undefined);
    } finally {
      await browser.close().catch(() => undefined);
    }

    expect(crashes, tag).toEqual([]);
  });
}
