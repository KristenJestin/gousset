import fc from "fast-check";
import { Option } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { EmptyFile, FileTooLarge, TooManyParts } from "./errors";
import { MAX_FILE_BYTES } from "./summary";
import {
  MAX_UPLOAD_PARTS,
  isSecretOf,
  newSecret,
  parseUploadToken,
  partRefusal,
  requestRefusal,
  secretHash,
  uploadState,
  uploadToken,
} from "./uploads";
import type { UploadProgress } from "./uploads";

const ID = "019a4f2e-7c1d-7a3b-9e4f-0123456789ab";

describe("upload addresses", () => {
  test("a token names its owner, its file upload and its secret, and reads back", () => {
    fc.assert(
      // Any owner without a control character; better-auth's ids are letters and digits.
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter((owner) => !/\p{Cc}/u.test(owner)),
        fc.uuid(),
        (owner, id) => {
          const secret = newSecret();

          expect(parseUploadToken(uploadToken(owner, id, secret))).toEqual(
            Option.some({ owner, id, secret }),
          );
        },
      ),
    );
  });

  test("a secret is 256 random bits, and only its hash is kept", () => {
    const secret = newSecret();

    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(newSecret()).not.toBe(secret);
    expect(secretHash(secret)).toMatch(/^[\da-f]{64}$/);
    expect(isSecretOf(secret, secretHash(secret))).toBe(true);
    expect(isSecretOf(newSecret(), secretHash(secret))).toBe(false);
  });

  test("anything not written by uploadToken names no file upload", () => {
    const secret = newSecret();
    const token = uploadToken("user-1", ID, secret);

    for (const wrong of [
      "",
      `${token}.more`,
      token.replace(ID, "not-an-id"),
      token.slice(0, -1),
      `${token}A`,
      `.${ID}.${secret}`,
      // An owner of a control character, which Postgres refuses as a setting.
      `AA.${ID}.${secret}`,
      // Another spelling of the same owner, which base64url would decode alike.
      `${token.split(".")[0] ?? ""}=.${ID}.${secret}`,
    ]) {
      expect(parseUploadToken(wrong), wrong).toEqual(Option.none());
    }
  });
});

describe("declaring a file upload", () => {
  test("the import's own limits, per file", () => {
    expect(requestRefusal(1000, 1)).toBeNull();
    expect(requestRefusal(MAX_FILE_BYTES, MAX_UPLOAD_PARTS)).toBeNull();
    expect(requestRefusal(0, 1)).toEqual(new EmptyFile());
    expect(requestRefusal(MAX_FILE_BYTES + 1, 1)).toEqual(
      new FileTooLarge({ bytes: MAX_FILE_BYTES + 1, limit: MAX_FILE_BYTES }),
    );
    expect(requestRefusal(1000, 0)).toEqual(new TooManyParts({ limit: MAX_UPLOAD_PARTS }));
    expect(requestRefusal(1000, MAX_UPLOAD_PARTS + 1)).toEqual(
      new TooManyParts({ limit: MAX_UPLOAD_PARTS }),
    );
  });

  test("never more parts than bytes", () => {
    expect(requestRefusal(3, 3)).toBeNull();
    expect(requestRefusal(3, 4)).toEqual(new TooManyParts({ limit: 3 }));
  });
});

const fresh = (size: number, parts: number): UploadProgress => ({
  size,
  parts,
  partsReceived: 0,
  bytesReceived: 0,
});

describe("receiving parts", () => {
  test("one part holds the whole file, numbered or not", () => {
    expect(partRefusal(fresh(100, 1), null, 100)).toBeNull();
    expect(partRefusal(fresh(100, 1), 1, 100)).toBeNull();
  });

  test("a file larger or smaller than declared is refused", () => {
    expect(partRefusal(fresh(100, 1), null, 101)?.reason).toBe("size");
    expect(partRefusal(fresh(100, 1), null, 99)?.reason).toBe("size");
    expect(partRefusal(fresh(100, 1), null, 0)?.reason).toBe("empty");
  });

  test("parts come in order, each once, and the last ends on the declared size", () => {
    const first = fresh(100, 3);

    expect(partRefusal(first, null, 40)).toMatchObject({ reason: "part_needed", expectedPart: 1 });
    expect(partRefusal(first, 2, 40)).toMatchObject({ reason: "out_of_order", expectedPart: 1 });
    expect(partRefusal(first, 1, 40)).toBeNull();
    // Each later part needs a byte at least.
    expect(partRefusal(first, 1, 99)).toMatchObject({ reason: "size", bytesLeft: 100 });
    expect(partRefusal(first, 1, 98)).toBeNull();

    const second = { ...first, partsReceived: 1, bytesReceived: 40 };

    expect(partRefusal(second, 1, 40)).toMatchObject({ reason: "out_of_order", expectedPart: 2 });
    expect(partRefusal(second, 2, 40)).toBeNull();

    const third = { ...first, partsReceived: 2, bytesReceived: 80 };

    expect(partRefusal(third, 3, 19)).toMatchObject({ reason: "size", bytesLeft: 20 });
    expect(partRefusal(third, 3, 20)).toBeNull();

    const done = { ...first, partsReceived: 3, bytesReceived: 100 };

    expect(partRefusal(done, 3, 20)?.reason).toBe("complete");
    expect(partRefusal(done, 4, 1)?.reason).toBe("complete");
  });

  test("whatever the parts sent, what is kept never passes the declared size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: MAX_UPLOAD_PARTS }),
        fc.array(
          fc.record({ part: fc.option(fc.integer({ min: 0, max: 25 })), bytes: fc.nat(12_000) }),
        ),
        (size, parts, sent) => {
          let partsReceived = 0;
          let bytesReceived = 0;

          for (const { part, bytes } of sent) {
            if (partRefusal({ size, parts, partsReceived, bytesReceived }, part, bytes) === null) {
              partsReceived += 1;
              bytesReceived += bytes;
            }
          }

          expect(bytesReceived).toBeLessThanOrEqual(size);
          expect(partsReceived).toBeLessThanOrEqual(parts);

          if (partsReceived === parts) {
            expect(bytesReceived).toBe(size);
          }
        },
      ),
    );
  });
});

describe("where a file upload stands", () => {
  const now = new Date("2026-11-24T10:00:00.000Z");
  const later = new Date("2026-11-24T10:15:00.000Z");

  test("pending until every part arrived, then uploaded, and expired past its expiry", () => {
    expect(uploadState(fresh(100, 2), later, now)).toBe("pending");
    expect(
      uploadState({ ...fresh(100, 2), partsReceived: 2, bytesReceived: 100 }, later, now),
    ).toBe("uploaded");
    expect(uploadState({ ...fresh(100, 2), partsReceived: 2, bytesReceived: 100 }, now, now)).toBe(
      "expired",
    );
  });
});
