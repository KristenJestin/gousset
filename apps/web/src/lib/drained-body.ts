/**
 * A request's body that is read to its end even when it is refused half way, its bytes thrown away
 * as they come, never kept: a server that answers before reading the whole body sees its client
 * cut off (`ECONNRESET`) before the answer, and a browser says the connection failed rather than
 * why. Past `limit` bytes thrown away, the connection is cut all the same.
 */
export function drainedBody(body: ReadableStream<Uint8Array>, limit: number) {
  const reader = body.getReader();
  let finished = false;

  /** Reads what is left, keeping nothing. */
  async function drain(): Promise<void> {
    let thrown = 0;

    while (!finished) {
      const { done, value } = await reader.read();

      if (done) {
        finished = true;

        return;
      }

      thrown += value.byteLength;

      if (thrown > limit) {
        finished = true;
        await reader.cancel();
      }
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        finished = true;
        controller.close();

        return;
      }

      controller.enqueue(value);
    },
    // Its reader stopped (a file over the limit): the rest is read and thrown away.
    cancel: drain,
  });

  return { stream, drain };
}
