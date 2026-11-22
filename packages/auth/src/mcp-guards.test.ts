import { describe, expect, test } from "vite-plus/test";

import {
  clientHost,
  createRequestLimit,
  isMetadataDocumentClient,
  redirectBoundToClient,
  withReadForWrite,
} from "./mcp-guards";

describe("the scopes asked for", () => {
  test("gain read when they hold write without it, so that read only can be granted", () => {
    expect(withReadForWrite("write")).toBe("write read");
    expect(withReadForWrite("write offline_access")).toBe("write offline_access read");
  });

  test("are kept as they are otherwise", () => {
    expect(withReadForWrite("read write")).toBe("read write");
    expect(withReadForWrite("read")).toBe("read");
    expect(withReadForWrite(undefined)).toBeUndefined();
  });
});

const CLIENT = "https://agent.example.com/oauth/client-metadata.json";

describe("a client's redirect", () => {
  test("on the client ID's own origin is bound to it", () => {
    expect(redirectBoundToClient(CLIENT, "https://agent.example.com/callback")).toBe(true);
  });

  test.each([
    ["localhost", "http://localhost:43123/callback"],
    ["127.0.0.1", "http://127.0.0.1:43123/callback"],
    ["::1", "http://[::1]:43123/callback"],
  ])("on %s is a native client's own machine", (_, uri) => {
    expect(redirectBoundToClient(CLIENT, uri)).toBe(true);
  });

  test.each([
    ["another site", "https://attacker.example/callback"],
    ["a sibling host", "https://evil.agent.example.com/callback"],
    ["plain HTTP on its host", "http://agent.example.com/callback"],
    ["HTTPS on loopback", "https://localhost/callback"],
    ["a custom scheme", "agent://callback"],
    ["nothing", undefined],
    ["no URL", "not a url"],
  ])("on %s is refused", (_, uri) => {
    expect(redirectBoundToClient(CLIENT, uri)).toBe(false);
  });

  test("Claude Code's metadata document passes", () => {
    const claudeCode = "https://claude.ai/oauth/claude-code-client-metadata";

    expect(redirectBoundToClient(claudeCode, "http://localhost:51234/callback")).toBe(true);
    expect(redirectBoundToClient(claudeCode, "http://127.0.0.1:51234/callback")).toBe(true);
  });
});

describe("where a client comes from", () => {
  test("is the host serving its metadata document, whatever name the document gives", () => {
    expect(clientHost("https://claude.ai/oauth/claude-code-client-metadata")).toBe("claude.ai");
    expect(clientHost(CLIENT)).toBe("agent.example.com");
  });

  test("is unknown for a client registered here", () => {
    expect(clientHost("gousset-e2e")).toBeNull();
  });
});

describe("a client ID", () => {
  test("is a metadata document when it is an HTTPS URL", () => {
    expect(isMetadataDocumentClient(CLIENT)).toBe(true);
    expect(isMetadataDocumentClient("gousset-e2e")).toBe(false);
    expect(isMetadataDocumentClient("http://agent.example.com/c.json")).toBe(false);
  });
});

describe("the request limit", () => {
  test("admits up to its maximum per key in the window, then refuses until the window moves", () => {
    const limit = createRequestLimit(3, 60_000);
    const start = 1_000_000;

    expect([1, 2, 3].map((n) => limit.admit("198.51.100.7", start + n))).toEqual([
      true,
      true,
      true,
    ]);
    expect(limit.admit("198.51.100.7", start + 10)).toBe(false);
    expect(limit.admit("203.0.113.9", start + 10)).toBe(true);
    expect(limit.admit("198.51.100.7", start + 60_002)).toBe(true);
  });
});
