import fc from "fast-check";
import { parse } from "pg-connection-string";
import { describe, expect, test } from "vite-plus/test";

import {
  APP_ROLE,
  appConnection,
  appLoginStatement,
  appRolePassword,
  connectionUser,
} from "./app-role";

/** An owner's URL as the image's entry point writes it: the password percent-encoded. */
const ownerUrl = (password: string) =>
  `postgresql://gousset:${encodeURIComponent(password)}@postgres:5432/gousset`;

/** The error a call throws, whole: its message and every property it carries. */
function thrownBy(call: () => void): string {
  try {
    call();
  } catch (error) {
    if (error instanceof Error) {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    }
  }

  return "nothing thrown";
}

describe("appConnection", () => {
  test("logs the app in as its own role, with the password derived from the owner's", () => {
    expect(appConnection(ownerUrl("made-up-owner-password"))).toEqual({
      user: APP_ROLE,
      password: appRolePassword("made-up-owner-password"),
      host: "postgres",
      port: 5432,
      database: "gousset",
    });
  });

  test("derives the password from any owner's password the URL carries", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, unit: "grapheme" }), (password) => {
        const connection = appConnection(ownerUrl(password));

        expect(connection.user).toBe(APP_ROLE);
        expect(connection.password).toBe(appRolePassword(password));
        expect(connection.host).toBe("postgres");
        expect(connection.database).toBe("gousset");
      }),
    );
  });

  test("reads the owner's password as the driver does, a stray % included", () => {
    const given = "postgresql://gousset:made%up@db:5432/gousset";

    expect(appConnection(given).password).toBe(appRolePassword(parse(given).password ?? ""));
  });

  test("keeps a socket's host", () => {
    expect(appConnection("postgresql:///gousset?host=/run/postgresql")).toMatchObject({
      user: APP_ROLE,
      host: "/run/postgresql",
      database: "gousset",
    });
    expect(
      appConnection("postgresql://gousset:secret@/gousset?host=/run/postgresql"),
    ).toMatchObject({
      user: APP_ROLE,
      password: appRolePassword("secret"),
      host: "/run/postgresql",
    });
  });

  test("replaces credentials given as query parameters too", () => {
    expect(
      appConnection("postgresql://db:5432/gousset?user=gousset&password=made-up-secret"),
    ).toMatchObject({ user: APP_ROLE, password: appRolePassword("made-up-secret") });
  });

  test("keeps a URL that already names the app's role", () => {
    expect(
      appConnection(`postgresql://${APP_ROLE}:chosen-by-hand@db.example.com:6543/books`),
    ).toEqual({
      user: APP_ROLE,
      password: "chosen-by-hand",
      host: "db.example.com",
      port: 6543,
      database: "books",
    });
  });

  test("gives no password when the owner's URL has none", () => {
    expect(appConnection("postgresql://owner@localhost:5432/gousset")).not.toHaveProperty(
      "password",
    );
  });

  test("never repeats the URL it cannot read", () => {
    expect(
      thrownBy(() => appConnection("postgresql://gousset:made-up-secret@db:99999/gousset")),
    ).not.toContain("made-up-secret");
  });
});

describe("connectionUser", () => {
  test("names the role, from the URL's user or its query", () => {
    expect(connectionUser("postgresql://gousset@db/gousset")).toBe("gousset");
    expect(connectionUser(`postgresql://db/gousset?user=${APP_ROLE}`)).toBe(APP_ROLE);
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

  test("reads the owner's password as the app does", () => {
    expect(appLoginStatement("postgresql://db/gousset?user=gousset&password=made%up")).toMatch(
      /^ALTER ROLE gousset_app WITH LOGIN PASSWORD 'SCRAM-SHA-256/,
    );
  });

  test("leaves the password as it is when the owner's URL has none", () => {
    expect(appLoginStatement("postgresql:///gousset?host=/run/postgresql")).toBe(
      "ALTER ROLE gousset_app WITH LOGIN",
    );
  });
});
