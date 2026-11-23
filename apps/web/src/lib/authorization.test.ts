import { describe, expect, test } from "vite-plus/test";

import { authorizationToResume } from "./authorization";

describe("authorizationToResume", () => {
  test("keeps the client's parameters and drops the server's signature of them", () => {
    const signed =
      "?response_type=code&client_id=gousset-e2e&redirect_uri=http%3A%2F%2F127.0.0.1%3A47213%2Fmcp%2Fcallback&scope=read&state=s&code_challenge=c&code_challenge_method=S256&exp=1800000000&ba_iat=1799999400000&ba_param=client_id&ba_param=exp&sig=abc";

    const resumed = new URLSearchParams(authorizationToResume(signed));

    expect([...resumed.keys()]).toEqual([
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ]);
    expect(resumed.get("redirect_uri")).toBe("http://127.0.0.1:47213/mcp/callback");
  });

  test("gives nothing when the sign-in page was opened for no client", () => {
    expect(authorizationToResume("")).toBeUndefined();
    expect(authorizationToResume("?redirect=%2Fsettings")).toBeUndefined();
  });
});
