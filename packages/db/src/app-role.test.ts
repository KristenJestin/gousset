import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { APP_ROLE, appDatabaseUrl, appLoginStatement, appRolePassword } from "./app-role";

/** An owner's URL as the image's entry point writes it: the password percent-encoded. */
const ownerUrl = (password: string) =>
  `postgresql://gousset:${encodeURIComponent(password)}@postgres:5432/gousset`;

describe("appDatabaseUrl", () => {
  test("logs the app in as its own role, with the password derived from the owner's", () => {
    expect(appDatabaseUrl(ownerUrl("made-up-owner-password"))).toBe(
      `postgresql://${APP_ROLE}:${appRolePassword("made-up-owner-password")}@postgres:5432/gousset`,
    );
  });

  test("derives the same password from any owner's password the URL carries", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, unit: "grapheme" }), (password) => {
        const url = new URL(appDatabaseUrl(ownerUrl(password)));

        expect(url.username).toBe(APP_ROLE);
        expect(decodeURIComponent(url.password)).toBe(appRolePassword(password));
        expect(url.host).toBe("postgres:5432");
        expect(url.pathname).toBe("/gousset");
      }),
    );
  });

  test("keeps a URL that already names the app's role, and the rest of any URL", () => {
    const given = `postgresql://${APP_ROLE}:chosen-by-hand@db.example.com:5432/gousset?sslmode=require`;

    expect(appDatabaseUrl(given)).toBe(given);
    expect(
      appDatabaseUrl("postgresql://owner:secret@db.example.com:6543/books?sslmode=require"),
    ).toBe(
      `postgresql://${APP_ROLE}:${appRolePassword("secret")}@db.example.com:6543/books?sslmode=require`,
    );
  });

  test("gives no password when the owner's URL has none", () => {
    expect(appDatabaseUrl("postgresql://owner@localhost:5432/gousset")).toBe(
      `postgresql://${APP_ROLE}@localhost:5432/gousset`,
    );
  });

  test("refuses a URL with no host, where no role can be named", () => {
    expect(() => appDatabaseUrl("postgresql:///gousset")).toThrow(/names no host/);
  });
});

describe("appRolePassword", () => {
  test("is not the owner's, and differs with it", () => {
    expect(appRolePassword("one")).not.toBe("one");
    expect(appRolePassword("one")).not.toBe(appRolePassword("two"));
    expect(appRolePassword("one")).toMatch(/^[\w-]{43}$/);
  });
});

describe("appLoginStatement", () => {
  test("sets a verifier of the derived password, never the password itself", () => {
    const statement = appLoginStatement(ownerUrl("made-up-owner-password"));

    expect(statement).toMatch(
      /^ALTER ROLE gousset_app WITH LOGIN PASSWORD 'SCRAM-SHA-256\$4096:[\w+/=]+\$[\w+/=]+:[\w+/=]+'$/,
    );
    expect(statement).not.toContain(appRolePassword("made-up-owner-password"));
    expect(statement).not.toContain("made-up-owner-password");
  });

  test("leaves the password as it is when the owner's URL has none", () => {
    expect(appLoginStatement("postgresql://owner@localhost:5432/gousset")).toBe(
      "ALTER ROLE gousset_app WITH LOGIN",
    );
  });
});
