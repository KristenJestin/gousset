/**
 * The request's body, read until `limit` bytes: past it, reading stops and `undefined` says it is
 * too large, before anything is kept or read. A `Content-Length` over the limit is refused before a
 * byte is read.
 */
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");

  if (declared > limit || request.body === null) {
    return declared > limit ? undefined : new Uint8Array();
  }

  const reader = request.body.getReader();
  const parts: Array<Uint8Array> = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > limit) {
      await reader.cancel();

      return undefined;
    }

    parts.push(value);
  }

  const bytes = new Uint8Array(size);
  let at = 0;

  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }

  return bytes;
}
