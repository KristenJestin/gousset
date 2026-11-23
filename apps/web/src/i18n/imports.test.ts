import { m } from "@gousset/i18n/messages";
import { describe, expect, test } from "vite-plus/test";

import { profileRefusalMessage } from "./imports";

// The import screen says every refusal of the profiles' calls (#19) in the user's words: none falls
// to the message for an error nobody named. Their French is checked with every message's
// (`packages/i18n`).
describe("a profile's refusals, as the screen says them", () => {
  test("each code has its own message", () => {
    const said = [
      { refused: "PROFILE_NOT_FOUND" },
      { refused: "PROFILE_UNREADABLE" },
      { refused: "PROFILE_NAME_MISSING" },
      { refused: "INVALID_PROFILE_FILE" },
      { refused: "PROFILE_TOO_LONG", limit: 100 },
      { refused: "TOO_MANY_PROFILES", limit: 50 },
    ].map(profileRefusalMessage);

    expect(said).not.toContain(m.importFailureOther());
    expect(new Set(said).size).toBe(said.length);
    expect(said.at(-2)).toContain("100");
    expect(said.at(-1)).toContain("50");
  });
});
