import { request } from "@playwright/test";

import { expect, test } from "../src/test";

// Issue #244: every MCP client of a test worker authorizes from one address, more than the 30 a
// minute an address is allowed by default, so the worker's app is started with
// MCP_AUTHORIZE_PER_MINUTE at 1000 (`src/test.ts`). The app must read that value when it starts,
// not the one it was built with: built in, the limit stayed at 30 and a worker running many MCP
// tests back to back met a 429 in place of the consent page. The default itself is tested on an
// installation of its own (`mcp.spec.ts`, "an address that starts too many authorizations…").

test("a worker's app takes the authorization limit it is started with", async ({ app }) => {
  const context = await request.newContext();

  try {
    const statuses: Array<number> = [];

    // More than the default 30, far fewer than the worker's 1000.
    for (let attempt = 0; attempt < 35; attempt += 1) {
      const answer = await context.get(`${app.baseURL}/api/auth/oauth2/authorize`, {
        maxRedirects: 0,
      });

      statuses.push(answer.status());
    }

    expect(statuses).not.toContain(429);
  } finally {
    await context.dispose();
  }
});
