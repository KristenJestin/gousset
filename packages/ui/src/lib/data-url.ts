/**
 * A file as a `data:` URL, to show a picked image before it is saved: the Content Security
 * Policy lets an image come from the app itself or from `data:` (`img-src 'self' data:`), never
 * from a `blob:` URL.
 */
export async function dataUrlOf(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const type = file.type === "" ? "application/octet-stream" : file.type;

  return `data:${type};base64,${btoa(binary)}`;
}
