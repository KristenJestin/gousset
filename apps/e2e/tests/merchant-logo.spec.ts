import { createHash } from "node:crypto";

import { request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { merchant } from "@gousset/db/schema/ledger";

import { addUser } from "../src/auth";
import type { TestUser } from "../src/auth";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #204, "How to verify" (2), the server's half: a merchant's logo uploaded to the app's route,
// served from the database with its own type, a policy that runs nothing and a cache kept for its
// version, replaced, removed; a file too large or of another type refused with a code; another
// user's merchant never reached. The pages that upload and show it are tried with them. Every
// picture is a format's first bytes, made here: no real logo.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

/** A PNG one byte over 256 KiB. */
function tooLarge() {
  const bytes = new Uint8Array(256 * 1024 + 1);

  bytes.set(PNG);

  return bytes;
}

const versionOf = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** A user of the test's own with one merchant, and a request context signed in as them. */
async function shopkeeper(
  app: { baseURL: string; database: string; slot: number },
  admin: TestUser,
  local: string,
) {
  const person = await addUser(app.baseURL, admin, {
    name: "Noa Example",
    email: `noa.${local}.worker${app.slot}@example.com`,
    password: `e2e-noa-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    const [made] = await data.asUser(owner, (transaction) =>
      transaction
        .insert(merchant)
        .values({ userId: owner, name: "Juniper Hardware" })
        .returning({ id: merchant.id }),
    );

    const context = await request.newContext({
      baseURL: app.baseURL,
      storageState: { cookies: [...person.cookies], origins: [] },
    });

    return { context, merchantId: made?.id ?? "" };
  } finally {
    await data.close();
  }
}

const upload = (context: APIRequestContext, merchantId: string, bytes: Uint8Array) =>
  context.post(`/api/merchants/${merchantId}/logo`, {
    headers: { "Content-Type": "application/octet-stream" },
    data: Buffer.from(bytes),
  });

test("an uploaded logo is served with its own type and version, replaced, and removed", async ({
  app,
  user,
}) => {
  const { context, merchantId } = await shopkeeper(app, user, "logo");
  const path = `/api/merchants/${merchantId}/logo`;

  try {
    const uploaded = await upload(context, merchantId, PNG);

    expect(uploaded.status()).toBe(200);
    expect(await uploaded.json()).toEqual({ version: versionOf(PNG) });

    const served = await context.get(`${path}?v=${versionOf(PNG)}`);

    expect(served.status()).toBe(200);
    expect(new Uint8Array(await served.body())).toEqual(PNG);
    expect(served.headers()["content-type"]).toBe("image/png");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");
    expect(served.headers()["content-security-policy"]).toContain("sandbox");
    expect(served.headers()["cache-control"]).toContain("immutable");

    // Asked without its version, it is asked again each time.
    expect((await context.get(path)).headers()["cache-control"]).toBe("private, no-cache");

    // A new one replaces it: one logo per merchant, at a new address.
    expect(await (await upload(context, merchantId, JPEG)).json()).toEqual({
      version: versionOf(JPEG),
    });

    const replaced = await context.get(`${path}?v=${versionOf(JPEG)}`);

    expect(replaced.headers()["content-type"]).toBe("image/jpeg");
    expect(new Uint8Array(await replaced.body())).toEqual(JPEG);

    // Removed: its avatar is shown again, and the route has nothing to serve.
    const removed = await context.delete(path);

    expect(removed.status()).toBe(200);
    expect(await removed.json()).toEqual({ version: null });

    const gone = await context.get(path);

    expect(gone.status()).toBe(404);
    expect(await gone.json()).toEqual({ refused: "LOGO_NOT_FOUND" });
  } finally {
    await context.dispose();
  }
});

test("a logo too large, of another type or empty is refused with a code, and nothing is kept", async ({
  app,
  user,
}) => {
  const { context, merchantId } = await shopkeeper(app, user, "refused");

  try {
    const refusals = [
      [tooLarge(), 413, "LOGO_TOO_LARGE"],
      [SVG, 415, "LOGO_TYPE"],
      [new Uint8Array(), 422, "LOGO_EMPTY"],
    ] as const;

    for (const [bytes, status, code] of refusals) {
      const answer = await upload(context, merchantId, bytes);

      expect(answer.status(), code).toBe(status);
      expect(await answer.json(), code).toEqual({ refused: code });
    }

    // Only the bytes say what it is: a declared type is no way in.
    const declared = await context.post(`/api/merchants/${merchantId}/logo`, {
      headers: { "Content-Type": "image/png" },
      data: Buffer.from(PNG),
    });

    expect(declared.status()).toBe(415);
    expect(await declared.json()).toEqual({ refused: "UPLOAD_FAILED" });

    expect((await context.get(`/api/merchants/${merchantId}/logo`)).status()).toBe(404);

    const unknown = await upload(context, "00000000-0000-7000-8000-000000000000", PNG);

    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toEqual({ refused: "MERCHANT_NOT_FOUND" });
  } finally {
    await context.dispose();
  }
});

test("another user's merchant's logo is never read, set nor removed, and a visitor reaches none", async ({
  app,
  user,
  playwright,
}) => {
  const owner = await shopkeeper(app, user, "owner");
  const other = await shopkeeper(app, user, "other");
  const anonymous = await playwright.request.newContext({ baseURL: app.baseURL });
  const path = `/api/merchants/${owner.merchantId}/logo`;

  try {
    expect((await upload(owner.context, owner.merchantId, PNG)).status()).toBe(200);

    for (const answer of [
      await other.context.get(path),
      await upload(other.context, owner.merchantId, JPEG),
      await other.context.delete(path),
    ]) {
      expect(answer.status()).toBe(404);
      expect(await answer.json()).toEqual({ refused: "MERCHANT_NOT_FOUND" });
    }

    const visitor = await anonymous.get(path);

    expect(visitor.status()).toBe(401);
    expect(await visitor.json()).toEqual({ refused: "SIGN_IN_REQUIRED" });

    // The owner's logo is as it was.
    const kept = await owner.context.get(path);

    expect(new Uint8Array(await kept.body())).toEqual(PNG);
  } finally {
    await owner.context.dispose();
    await other.context.dispose();
    await anonymous.dispose();
  }
});
