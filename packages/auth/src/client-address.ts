import { getIPFromHeader, isValidIP, normalizeIP } from "@better-auth/core/utils/ip";

/**
 * The header the app writes the resolved client address into before better-auth reads the
 * request. Whatever the client sent under that name is dropped first.
 */
export const CLIENT_ADDRESS_HEADER = "x-gousset-client-address";

/**
 * The client's address, which failed sign-ins are counted against.
 *
 * It is the connection's peer. `X-Forwarded-For` is read only when that peer is one of the
 * trusted proxies, from the right, up to the first hop that is not a trusted proxy: a client
 * cannot get fresh attempts by writing a new header, and clients without one never share a
 * count. `undefined` when the peer is not an address.
 */
export function resolveClientAddress(
  peer: string | undefined,
  forwardedFor: string | null,
  trustedProxies: ReadonlyArray<string>,
): string | undefined {
  if (peer === undefined || !isValidIP(peer)) {
    return undefined;
  }

  if (trustedProxies.length === 0 || forwardedFor === null) {
    return normalizeIP(peer);
  }

  return (
    getIPFromHeader(`${forwardedFor},${peer}`, { trustedProxies: [...trustedProxies] }) ??
    normalizeIP(peer)
  );
}

/**
 * Whether to warn now that an `X-Forwarded-For` is ignored because no proxy is trusted: once per
 * process, on the first request that carries one. Behind a proxy, every client then shares the
 * proxy's address until `TRUSTED_PROXIES` names it.
 */
export function createIgnoredForwardWarning() {
  let warned = false;

  return (forwardedFor: string | null, trustedProxies: ReadonlyArray<string>): boolean => {
    if (warned || forwardedFor === null || trustedProxies.length > 0) {
      return false;
    }

    warned = true;

    return true;
  };
}

/**
 * The request better-auth handles, carrying the resolved client address and nothing forged.
 *
 * Built anew from its parts: the server's own `Request` class cannot be passed to the platform's
 * constructor. better-auth's bodies are small JSON, read whole.
 */
export async function withClientAddress(
  request: Request,
  address: string | undefined,
): Promise<Request> {
  const headers = new Headers(request.headers);

  headers.delete(CLIENT_ADDRESS_HEADER);

  if (address !== undefined) {
    headers.set(CLIENT_ADDRESS_HEADER, address);
  }

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
}
