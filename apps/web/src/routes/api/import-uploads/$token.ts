import { grantStillWrites } from "@gousset/auth/mcp-door";
import { Imports } from "@gousset/core";
import type { FileUploadPartRefused, ReceivedPart } from "@gousset/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect, Predicate } from "effect";

import { boundedBody } from "../../../lib/bounded-body";
import { isDoorOpen, notFound } from "../../../lib/mcp-door";
import { db, runCore } from "../../../services";

// The address an agent sends a statement to from its own shell (#129), made by the MCP door's
// `imports` `create_upload`: `curl -sS -F 'file=@statement.ofx' <address>`. The address is the
// only credential: unguessable (256 random bits, kept hashed), for one file, one user and one
// grant, and short-lived. Its answers are plain text, for the agent that reads curl's output.

const NO_STORE = { "Cache-Control": "no-store" };

const text = (body: string, status: number) =>
  new Response(`${body}\n`, {
    status,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });

/** What a step of the route found, or the answer that ends the request there. */
type Step<A> = { readonly found: A } | { readonly answer: Response };

const answer = (body: string, status: number) => ({ answer: text(body, status) });

/** Room for a form's boundaries and its fields' headers around the part's own bytes. */
const MULTIPART_ROOM = 64 * 1024;

const PART = /^[1-9]\d{0,2}$/;

const NEW_UPLOAD =
  'Make a new one: imports {"action":"create_upload","file_name":"statement.ofx","size":1048576}';

/**
 * A browser always says so (`Origin` on a cross-site POST, `Sec-Fetch-Site`) and carries the
 * user's cookies; curl does none of it. A form of another site posted at this address, or a page
 * holding it, is turned away before anything is read: the address takes no session at all.
 */
function fromBrowser(headers: Headers): boolean {
  return ["origin", "sec-fetch-site", "cookie"].some((name) => headers.has(name));
}

/** The part sent: its number when given, and its bytes; or the answer that refuses it. */
async function partOf(
  request: Request,
  bytesLeft: number,
): Promise<Step<{ part: number | null; content: Uint8Array }>> {
  const type = request.headers.get("content-type") ?? "";

  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return answer(
      "Send the file as the form field file, as it is: curl -sS -F 'file=@statement.ofx' <this address>",
      415,
    );
  }

  const body = await boundedBody(request, bytesLeft + MULTIPART_ROOM);

  if (body === undefined) {
    return answer(
      `This is more than the file upload still expects (${bytesLeft} bytes): its parts add up to the size declared, exactly.`,
      413,
    );
  }

  const form = await new Response(body, { headers: { "Content-Type": type } })
    .formData()
    .catch(() => undefined);

  // A field is text, or a file (curl's @).
  const file = form?.get("file") ?? null;
  const part = form?.get("part") ?? null;

  if (file === null || Predicate.isString(file)) {
    return answer(
      "The form holds no file: send it as the field file, with its @: curl -sS -F 'file=@statement.ofx' <this address>",
      400,
    );
  }

  if (part !== null && !(Predicate.isString(part) && PART.test(part))) {
    return answer("part is the part's number, from 1, as -F part=1 sends it.", 400);
  }

  return {
    found: {
      part: part === null ? null : Number(part),
      content: new Uint8Array(await file.arrayBuffer()),
    },
  };
}

function receivedText(received: ReceivedPart): string {
  if (!received.complete) {
    return `Received part ${received.part} of ${received.parts}: ${received.bytesReceived} of ${received.size} bytes so far. Send part ${received.part + 1} next, to the same address.`;
  }

  const what = received.parts === 1 ? "the file" : `part ${received.part} of ${received.parts}`;

  return `Received ${what}: ${received.bytesReceived} bytes, the whole file. Import it now: imports {"action":"upload","file_upload":"${received.id}"}`;
}

function refusedPart(refused: FileUploadPartRefused): Response {
  switch (refused.reason) {
    case "part_needed": {
      return text(
        `This file upload comes in ${refused.parts} parts: number each, from 1, as -F part=${refused.expectedPart} does.`,
        400,
      );
    }

    case "out_of_order": {
      return text(
        `Parts come in order, each once: send part ${refused.expectedPart} next (-F part=${refused.expectedPart}).`,
        409,
      );
    }

    case "complete": {
      return text(
        "The whole file has arrived already: import it with imports upload and its file_upload.",
        409,
      );
    }

    case "empty": {
      return text("This part is empty: send the file's bytes, with -F 'file=@<its path>'.", 422);
    }

    case "size": {
      return text(
        `This part does not fit the size declared: ${refused.bytesLeft} bytes are still expected, in ${refused.parts - refused.expectedPart + 1} part(s), each holding a byte at least, the last ending the file. Send the file as it is, not converted; if the size declared was wrong, make a new file upload with the right one.`,
        422,
      );
    }
  }
}

const UNAVAILABLE = "Gousset could not keep it just now: send it again in a moment.";

/** The file upload the token names, once its secret, its expiry and its grant are checked. */
async function addressed(token: string) {
  const named = await runCore(
    Effect.gen(function* () {
      const imports = yield* Imports;

      return { found: yield* imports.uploadAddress(token) };
    }).pipe(
      Effect.catchTags({
        FileUploadNotFound: () =>
          Effect.succeed(
            answer(
              `No file upload waits at this address: it was imported already, it expired, or the address is not whole. ${NEW_UPLOAD}`,
              404,
            ),
          ),
        FileUploadExpired: (expired) =>
          Effect.succeed(
            answer(`This file upload expired at ${expired.expiresAt}. ${NEW_UPLOAD}`, 410),
          ),
        QueryFailed: () => Effect.succeed(answer(UNAVAILABLE, 503)),
      }),
    ),
  );

  // A grant revoked, or a user banned or given a temporary password, has its uploads deleted with
  // it; one narrowed to read only keeps them, unwritable.
  if ("found" in named && !(await grantStillWrites(db, named.found.owner, named.found.grantId))) {
    return answer(
      `The MCP connection that made this file upload may no longer write to Gousset. ${NEW_UPLOAD}, from a connection allowed to read and write.`,
      403,
    );
  }

  return named;
}

/**
 * The addresses a request is being read for, in this process: one at a time each, so that requests
 * sent at once to one address never each hold a part in memory before all but one are refused.
 */
const receiving = new Set<string>();

/** Receives what was sent to an address, the only request reading for it meanwhile. */
async function receiveAlone(request: Request, token: string): Promise<Response> {
  if (receiving.has(token)) {
    return text(
      "A part is being received at this address: wait for its answer, then send the next.",
      409,
    );
  }

  receiving.add(token);

  try {
    return await receive(request, token);
  } finally {
    receiving.delete(token);
  }
}

async function receive(request: Request, token: string): Promise<Response> {
  if (fromBrowser(request.headers)) {
    return text(
      "This address takes a file sent from a command line (curl), never from a browser.",
      403,
    );
  }

  // The door closed by the administrator closes its uploads too.
  if (!(await isDoorOpen())) {
    return notFound();
  }

  const named = await addressed(token);

  if ("answer" in named) {
    return named.answer;
  }

  const read = await partOf(request, named.found.bytesLeft);

  if ("answer" in read) {
    return read.answer;
  }

  const { part, content } = read.found;

  return runCore(
    Effect.gen(function* () {
      const imports = yield* Imports;

      return text(receivedText(yield* imports.receivePart(token, part, content)), 200);
    }).pipe(
      Effect.catchTags({
        FileUploadNotFound: () =>
          Effect.succeed(text(`No file upload waits at this address anymore. ${NEW_UPLOAD}`, 404)),
        FileUploadExpired: (expired) =>
          Effect.succeed(
            text(`This file upload expired at ${expired.expiresAt}. ${NEW_UPLOAD}`, 410),
          ),
        FileUploadPartRefused: (refused) => Effect.succeed(refusedPart(refused)),
        QueryFailed: () => Effect.succeed(text(UNAVAILABLE, 503)),
      }),
    ),
  );
}

/**
 * Receives a file, or one part of it, for the file upload its token names: `file` holds its bytes,
 * `part` its number when it comes in several. Nothing but a POST is served.
 */
export const Route = createFileRoute("/api/import-uploads/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => receiveAlone(request, params.token),
    },
  },
});
