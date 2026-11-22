import { isLoopbackHost } from "@better-auth/core/utils/host";

/**
 * The scopes an authorization asks for, with `read` added to `write`: writing implies reading, and
 * the consent page can then always offer read only, which better-auth grants only from what was
 * asked. `undefined` when the request names no scope.
 */
export function withReadForWrite(scope: string | undefined): string | undefined {
  if (scope === undefined) {
    return undefined;
  }

  const scopes = scope.split(" ").filter((part) => part !== "");

  return scopes.includes("write") && !scopes.includes("read")
    ? [...scopes, "read"].join(" ")
    : scope;
}

/** A client identified by its metadata document (CIMD): its client ID is an HTTPS URL. */
export function isMetadataDocumentClient(clientId: string): boolean {
  return URL.canParse(clientId) && new URL(clientId).protocol === "https:";
}

/**
 * Where a client really comes from: the host of its client ID when it is a metadata document,
 * which only that host can serve, unlike the name the document gives. `null` for a client
 * registered here.
 */
export function clientHost(clientId: string): string | null {
  return isMetadataDocumentClient(clientId) ? new URL(clientId).host : null;
}

/**
 * Whether a metadata-document client may be sent back to this redirect: on its client ID's own
 * origin (a web client), or over HTTP on the user's own machine (a native client, as Claude Code
 * is). A document can name any redirect, and the consent page shows the name it gives itself: this
 * keeps a look-alike document from sending the code to another site.
 */
export function redirectBoundToClient(clientId: string, redirectUri: string | undefined): boolean {
  if (redirectUri === undefined || !URL.canParse(redirectUri) || !URL.canParse(clientId)) {
    return false;
  }

  const redirect = new URL(redirectUri);

  if (redirect.protocol === "http:" && isLoopbackHost(redirect.hostname)) {
    return true;
  }

  return redirect.protocol === "https:" && redirect.origin === new URL(clientId).origin;
}

/**
 * Requests counted per key (a client address) in a sliding window, in this process's memory: an
 * unauthenticated request that makes the server fetch a document and write a client is admitted
 * a few times a minute, not without bound.
 */
export function createRequestLimit(max: number, windowMs: number) {
  const byKey = new Map<string, Array<number>>();

  return {
    /** Counts the request and says whether it may go on. */
    admit(key: string, now: number): boolean {
      for (const [known, times] of byKey) {
        if (times.every((time) => time <= now - windowMs)) {
          byKey.delete(known);
        }
      }

      const recent = (byKey.get(key) ?? []).filter((time) => time > now - windowMs);

      if (recent.length >= max) {
        byKey.set(key, recent);

        return false;
      }

      byKey.set(key, [...recent, now]);

      return true;
    },
  };
}
