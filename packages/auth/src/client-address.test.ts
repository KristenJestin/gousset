import { describe, expect, it } from "vite-plus/test";

import {
  CLIENT_ADDRESS_HEADER,
  createIgnoredForwardWarning,
  resolveClientAddress,
  withClientAddress,
} from "./client-address";

describe("the warning on an ignored X-Forwarded-For", () => {
  it("comes once, on the first request that carries one while no proxy is trusted", () => {
    const shouldWarn = createIgnoredForwardWarning();

    expect(shouldWarn(null, [])).toBe(false);
    expect(shouldWarn("198.51.100.1", [])).toBe(true);
    expect(shouldWarn("198.51.100.2", [])).toBe(false);
  });

  it("never comes when a proxy is trusted", () => {
    const shouldWarn = createIgnoredForwardWarning();

    expect(shouldWarn("198.51.100.1", ["10.0.0.0/8"])).toBe(false);
  });
});

describe("the client's address", () => {
  it("is the connection's peer when no proxy is trusted", () => {
    expect(resolveClientAddress("203.0.113.7", null, [])).toBe("203.0.113.7");
  });

  it("ignores X-Forwarded-For when no proxy is trusted, so rotating it changes nothing", () => {
    expect(resolveClientAddress("203.0.113.7", "198.51.100.1", [])).toBe("203.0.113.7");
    expect(resolveClientAddress("203.0.113.7", "198.51.100.2", [])).toBe("203.0.113.7");
  });

  it("ignores X-Forwarded-For from a peer that is not a trusted proxy", () => {
    expect(resolveClientAddress("203.0.113.7", "198.51.100.1", ["10.0.0.0/8"])).toBe("203.0.113.7");
  });

  it("reads the client behind a trusted proxy", () => {
    expect(resolveClientAddress("10.0.0.2", "198.51.100.1", ["10.0.0.0/8"])).toBe("198.51.100.1");
  });

  it("takes the last untrusted hop, never what the client wrote first", () => {
    expect(resolveClientAddress("10.0.0.2", "192.0.2.66, 198.51.100.1", ["10.0.0.0/8"])).toBe(
      "198.51.100.1",
    );
  });

  it("is the proxy itself when the proxy forwards no client", () => {
    expect(resolveClientAddress("10.0.0.2", null, ["10.0.0.0/8"])).toBe("10.0.0.2");
  });

  it("is told apart for two clients without any header, so they never share a count", () => {
    expect(resolveClientAddress("203.0.113.7", null, [])).not.toBe(
      resolveClientAddress("203.0.113.8", null, []),
    );
  });

  it("reads an IPv4 address mapped in IPv6 as IPv4", () => {
    expect(resolveClientAddress("::ffff:203.0.113.7", null, [])).toBe("203.0.113.7");
  });

  it("replaces whatever address the client wrote in the request, and keeps its body", async () => {
    const forged = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { [CLIENT_ADDRESS_HEADER]: "192.0.2.1", "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com" }),
    });

    const request = await withClientAddress(forged, "203.0.113.7");

    expect(request.headers.get(CLIENT_ADDRESS_HEADER)).toBe("203.0.113.7");
    expect(await request.text()).toBe('{"email":"ada@example.com"}');
  });

  it("drops a forged address when the real one is unknown", async () => {
    const forged = new Request("http://localhost/api/auth/get-session", {
      headers: { [CLIENT_ADDRESS_HEADER]: "192.0.2.1" },
    });

    const request = await withClientAddress(forged, undefined);

    expect(request.headers.get(CLIENT_ADDRESS_HEADER)).toBeNull();
  });

  it("is unknown when the peer is not an address", () => {
    expect(resolveClientAddress(undefined, "198.51.100.1", [])).toBeUndefined();
    expect(resolveClientAddress("not an address", null, [])).toBeUndefined();
  });
});
