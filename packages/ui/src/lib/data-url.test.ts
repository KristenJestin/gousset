import { describe, expect, test } from "vite-plus/test";

import { dataUrlOf } from "./data-url";

describe("dataUrlOf", () => {
  test("writes a file's bytes as a base64 data: URL of its type", async () => {
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])], {
      type: "image/png",
    });

    expect(await dataUrlOf(file)).toBe("data:image/png;base64,iVBORwD/");
  });

  test("names a file without a type as plain bytes", async () => {
    expect(await dataUrlOf(new Blob(["Gousset"]))).toBe(
      "data:application/octet-stream;base64,R291c3NldA==",
    );
  });
});
