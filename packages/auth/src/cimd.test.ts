import { validateCimdMetadata, validateClientIdUrl } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { describe, expect, test } from "vite-plus/test";

import { cimdOptions } from "./cimd";

// Gousset's checks of a Client ID Metadata Document (cimd.ts). The end-to-end harness cannot serve
// one (no public HTTPS address in a test run), so they are proved here, on Gousset's options.

const CLIENT_ID = "https://agent.example.com/oauth/client-metadata.json";

const validDocument = {
  client_id: CLIENT_ID,
  client_name: "Example Agent",
  redirect_uris: ["http://localhost/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

/** A document as a client might serve it: any of its fields may be missing or extra. */
type ServedDocument = { readonly [field: string]: string | ReadonlyArray<string> };

const check = (document: ServedDocument) =>
  validateCimdMetadata(CLIENT_ID, document, { metadataProfile: cimdOptions.metadataProfile });

describe("a client ID", () => {
  test("is an HTTPS URL on a public host", () => {
    expect(validateClientIdUrl(CLIENT_ID)).toBeNull();
  });

  test.each([
    ["plain HTTP", "http://agent.example.com/oauth/client-metadata.json"],
    ["loopback", "https://127.0.0.1/oauth/client-metadata.json"],
    ["localhost", "https://localhost/oauth/client-metadata.json"],
    ["a private address", "https://192.168.1.10/oauth/client-metadata.json"],
    ["another private address", "https://10.0.0.7/oauth/client-metadata.json"],
    ["a link-local address", "https://169.254.169.254/latest/meta-data"],
    ["credentials", "https://user:secret@agent.example.com/oauth/client-metadata.json"],
    ["a fragment", "https://agent.example.com/oauth/client-metadata.json#x"],
  ])("is refused with %s", (_, url) => {
    expect(validateClientIdUrl(url)).not.toBeNull();
  });
});

describe("a metadata document, under the MCP 2026-07-28 profile", () => {
  test("is Gousset's profile", () => {
    expect(cimdOptions.metadataProfile).toBe("mcp-2026-07-28");
  });

  test("is accepted with its name and redirect URIs", () => {
    expect(check(validDocument).valid).toBe(true);
  });

  test("is refused without a client name", () => {
    const { client_name: _, ...nameless } = validDocument;

    expect(check(nameless).valid).toBe(false);
  });

  test("is refused without redirect URIs", () => {
    const { redirect_uris: _, ...nowhere } = validDocument;

    expect(check(nowhere).valid).toBe(false);
  });

  test("is refused when its client_id is not the URL it was read from", () => {
    expect(
      check({ ...validDocument, client_id: "https://other.example.com/metadata.json" }).valid,
    ).toBe(false);
  });

  test("is refused when it claims a client secret", () => {
    expect(check({ ...validDocument, client_secret: "not-a-real-secret" }).valid).toBe(false);
  });
});

describe("the transport", () => {
  test("is the one that resolves once, refuses private addresses and follows no redirect", () => {
    expect(cimdOptions.fetchClientMetadataResource).toBe(fetchClientMetadataResource);
  });

  test("refuses to read a document from a loopback address", async () => {
    await expect(
      cimdOptions.fetchClientMetadataResource("https://127.0.0.1/metadata.json", {
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toThrow();
  });
});
