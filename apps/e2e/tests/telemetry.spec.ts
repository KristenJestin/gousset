import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { disallowedAttributes } from "@gousset/telemetry";
import { startOtlpReceiver } from "@gousset/telemetry/testing";
import type { OtlpReceiver } from "@gousset/telemetry/testing";

import { expect, test } from "../src/test";

/** Effect's OTLP exporter sends what it holds every 5 seconds. */
const EXPORT_INTERVAL_MS = 5000;

/** A collector started for the worker, and the worker's app pointed at it by `environment`. */
const withCollector = (environment: (collector: OtlpReceiver) => Record<string, string>) =>
  test.extend<object, { collector: OtlpReceiver }>({
    collector: [
      // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, even when there are none.
      async ({}, provide) => {
        const collector = await startOtlpReceiver();

        try {
          await provide(collector);
        } finally {
          await collector.close();
        }
      },
      { scope: "worker" },
    ],
    appEnvironment: [
      async ({ collector }, provide) => {
        await provide(environment(collector));
      },
      { scope: "worker" },
    ],
  });

const exporting = withCollector((collector) => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
}));

// Only OTEL_EXPORTER_OTLP_ENDPOINT turns telemetry on: a signal's own variable does not.
const notExporting = withCollector((collector) => ({
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}/v1/traces`,
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}/v1/logs`,
}));

// What the server sends does not depend on the browser or the screen: one project is enough.
// oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, even when there are none.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "the server's output, checked once");
});

exporting(
  "with the endpoint set to a local collector, a page load gives a trace",
  async ({ page, collector }) => {
    await page.goto("/");

    await expect
      .poll(() => collector.spans().map(({ name }) => name), {
        timeout: EXPORT_INTERVAL_MS * 3,
      })
      .toContain("GET");

    const spans = collector.spans();

    expect(
      disallowedAttributes(spans.flatMap(({ attributes }) => attributes.map(({ key }) => key))),
    ).toEqual([]);
  },
);

exporting(
  "each attempt of a background job gives a span, with its job and how it ended",
  async ({ userPage: page, collector }) => {
    await page.goto("/e2e/jobs");
    await page.getByLabel("Items to count").fill("1");
    await page.getByLabel("Milliseconds per item").fill("100");
    await page.getByLabel("Attempts that fail").fill("0");
    await page.getByRole("button", { name: "Start the test job" }).click();
    await expect(page.locator('[data-slot="job-progress-status"]')).toHaveText("Done", {
      timeout: 10_000,
    });

    await expect
      .poll(() => collector.spans().map(({ name }) => name), {
        timeout: EXPORT_INTERVAL_MS * 3,
      })
      .toContain("job");

    const job = collector.spans().find(({ name }) => name === "job");

    expect(job?.attributes.map(({ key }) => key)).toEqual(
      expect.arrayContaining([
        "gousset.job.name",
        "gousset.job.id",
        "gousset.job.attempt",
        "gousset.job.outcome",
      ]),
    );
    expect(
      disallowedAttributes(
        collector.spans().flatMap(({ attributes }) => attributes.map(({ key }) => key)),
      ),
    ).toEqual([]);
  },
);

notExporting("without the endpoint, nothing is sent", async ({ page, collector }) => {
  await page.goto("/");

  // Long enough for an export to have happened, had one been set up.
  await sleep(EXPORT_INTERVAL_MS * 2);

  expect(collector.received()).toEqual([]);
});

const PUBLIC_BUILD = fileURLToPath(new URL("../../web/.output/public", import.meta.url));

const filesUnder = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { withFileTypes: true, recursive: true }).flatMap((entry) =>
    entry.isFile() ? [join(entry.parentPath, entry.name)] : [],
  );

// The local build's files, every chunk included, even those no page loads; a run against an image
// (E2E_APP_IMAGE) still checks the build of the same commit.
test("the production bundle holds no devtools code", () => {
  const withDevtools = filesUnder(PUBLIC_BUILD).filter((file) =>
    // TanStack's devtools leave the lowercase word in every chunk they reach (checked once on a
    // build that forced them in); React DOM's own `__REACT_DEVTOOLS_GLOBAL_HOOK__` is uppercase.
    readFileSync(file, "latin1").includes("devtools"),
  );

  expect(withDevtools).toEqual([]);
});
