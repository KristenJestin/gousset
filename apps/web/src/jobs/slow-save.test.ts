import { describe, expect, test } from "vite-plus/test";

import { SLOW_SAVE_MS, queryWithoutValues, slowSaveLines } from "./slow-save";
import type { Activity } from "./slow-save";

// The lines an import's save logs once it lasts (#241): ids, counts, waits and queries without
// their values, never a value of the user's. Every value here is invented.

const IMPORT = "0196a0c4-1111-7000-8000-000000000001";
const NAME = `gousset-import:${IMPORT}`;
const POOL = { total: 10, idle: 2, waiting: 0 };

const activity = (overrides: Partial<Activity>): Activity => ({
  pid: 100,
  state: "active",
  wait_event_type: null,
  wait_event: null,
  application_name: "",
  transaction_seconds: 1,
  blocked_by: [],
  query: null,
  ...overrides,
});

test("a save says what it waits on once it has run 20 seconds", () => {
  expect(SLOW_SAVE_MS).toBe(20_000);
});

describe("queryWithoutValues", () => {
  test("writes over every string and number, and keeps the parameters", () => {
    expect(
      queryWithoutValues(
        "update \"statement_line\" set label = 'CB EXEMPLE MAGASIN 12', amount_minor = -1250.5 where id = $1 and t2.x = $2",
      ),
    ).toBe(
      "update \"statement_line\" set label = '…', amount_minor = -… where id = $1 and t2.x = $2",
    );
  });

  test("keeps a quote doubled inside a string written over", () => {
    expect(queryWithoutValues("select 'l''atelier', 'b'")).toBe("select '…', '…'");
  });

  test("puts the query on one line, cut to 200 characters", () => {
    const written = queryWithoutValues(`select\n  ${"a, ".repeat(100)}b`);

    expect(written).not.toContain("\n");
    expect(written).toHaveLength(200);
    expect(written.endsWith("…")).toBe(true);
  });

  test("says none for a connection whose query it may not see", () => {
    expect(queryWithoutValues(null)).toBe("none");
  });
});

describe("slowSaveLines", () => {
  test("names the import's waiting connection, who blocks it, and the blocker first", () => {
    const lines = slowSaveLines(IMPORT, NAME, 20, POOL, [
      activity({ pid: 7, application_name: "gousset-jobs", query: "select 1" }),
      activity({
        pid: 42,
        application_name: NAME,
        wait_event_type: "Lock",
        wait_event: "transactionid",
        transaction_seconds: 19,
        blocked_by: [51],
        query: 'select "status" from "statement_import" where "id" = $1 for update',
      }),
      activity({
        pid: 51,
        state: "idle in transaction",
        wait_event_type: "Client",
        wait_event: "ClientRead",
        transaction_seconds: 40,
        query: 'update "statement_import" set "job_id" = $1 where "id" = $2',
      }),
    ]);

    expect(lines).toEqual([
      `import ${IMPORT}: its save has run 20 s; pool total=10 idle=2 waiting=0`,
      'import connection pid=42 state=active wait=Lock/transactionid transaction=19s blocked_by=51 query="select "status" from "statement_import" where "id" = $1 for update"',
      'other connection pid=51 state=idle in transaction wait=Client/ClientRead transaction=40s app=none blocks_import=yes query="update "statement_import" set "job_id" = $1 where "id" = $2"',
      'other connection pid=7 state=active wait=none/none transaction=1s app=gousset-jobs blocks_import=no query="select …"',
    ]);
  });

  test("an import with no connection open waits outside the database", () => {
    const lines = slowSaveLines(IMPORT, NAME, 20, { total: 10, idle: 0, waiting: 3 }, []);

    expect(lines).toEqual([
      `import ${IMPORT}: its save has run 20 s; pool total=10 idle=0 waiting=3`,
      "import connection: none open, so it waits outside the database (the pool, or its code)",
    ]);
  });
});
