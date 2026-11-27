/**
 * A `Content-Disposition` that saves the download under `fileName`: as it is for a browser that
 * reads RFC 6266's `filename*`, its ASCII letters alone for one that does not.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replaceAll(/[^\u0020-\u007E]|["\\%]/gu, "_");

  const encoded = encodeURIComponent(fileName).replaceAll(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
