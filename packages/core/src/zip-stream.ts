import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

// A zip written as it is read (#217): receipts of 50 MB each would not fit in memory together, so
// each file is read from its stream only when the reader asks for more, and stored as it is
// (photos and PDFs are compressed already). Small files made in memory (an export's JSON and CSV)
// are deflated.

/** A file of the zip: its bytes at hand, or a stream opened when its turn comes. */
export type ZipEntry =
  | { readonly path: string; readonly content: Uint8Array }
  | { readonly path: string; readonly open: () => Promise<ReadableStream<Uint8Array>> };

/** The zip of `entries`, in their order, each dated `modifiedAt`. */
export function zipStream(
  entries: ReadonlyArray<ZipEntry>,
  modifiedAt: Date,
): ReadableStream<Uint8Array> {
  const queue: Array<Uint8Array> = [];
  let ended = false;
  let failure: Error | undefined;

  const zip = new Zip((error, chunk, final) => {
    if (error !== null) {
      failure = error;

      return;
    }

    queue.push(chunk);
    ended = final;
  });

  let next = 0;

  let reading:
    | { file: ZipPassThrough; reader: ReadableStreamDefaultReader<Uint8Array> }
    | undefined;

  /** Moves the zip on by one step: a chunk of the file being read, or the next file. */
  async function step(): Promise<void> {
    if (reading !== undefined) {
      const { done, value } = await reading.reader.read();

      if (done) {
        reading.file.push(new Uint8Array(), true);
        reading = undefined;
      } else {
        reading.file.push(value, false);
      }

      return;
    }

    const entry = entries[next];

    if (entry === undefined) {
      zip.end();

      return;
    }

    next += 1;

    if ("content" in entry) {
      const file = new ZipDeflate(entry.path, { level: 6 });

      file.mtime = modifiedAt;
      zip.add(file);
      file.push(entry.content, true);

      return;
    }

    const file = new ZipPassThrough(entry.path);

    file.mtime = modifiedAt;
    zip.add(file);
    reading = { file, reader: (await entry.open()).getReader() };
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // A pull gives at least one chunk, or ends the stream: one that gave none would not be
      // called again.
      while (queue.length === 0 && !ended && failure === undefined) {
        await step();
      }

      if (failure !== undefined) {
        controller.error(failure);

        return;
      }

      for (const chunk of queue.splice(0)) {
        controller.enqueue(chunk);
      }

      if (ended) {
        controller.close();
      }
    },
    async cancel() {
      zip.terminate();
      await reading?.reader.cancel();
    },
  });
}

/** Reads a stream whole. */
export async function bytesOf(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Array<Uint8Array> = [];
  const reader = stream.getReader();
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    size += value.byteLength;
  }

  const whole = new Uint8Array(size);
  let at = 0;

  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }

  return whole;
}
