import { describe, expect, test } from "vite-plus/test";

import { securityHeaders, servedOverHttps } from "./security";

/** The Strict-Transport-Security header the app sends when started at `url`. */
const transportSecurityAt = (url: string) =>
  securityHeaders({
    nonce: "n",
    strict: true,
    https: servedOverHttps({ BETTER_AUTH_URL: url }),
  }).get("Strict-Transport-Security");

describe("servedOverHttps", () => {
  test("follows the address the app is started with", () => {
    expect(servedOverHttps({ BETTER_AUTH_URL: "https://gousset.example.com" })).toBe(true);
    expect(servedOverHttps({ BETTER_AUTH_URL: "http://192.0.2.10:3001" })).toBe(false);
  });

  test("an app served over HTTPS sends Strict-Transport-Security, over HTTP never", () => {
    expect(transportSecurityAt("https://gousset.example.com")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(transportSecurityAt("http://192.0.2.10:3001")).toBeNull();
  });
});
