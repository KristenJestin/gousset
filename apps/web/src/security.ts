/** A fresh nonce for one response's Content Security Policy. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return btoa(String.fromCodePoint(...bytes));
}

/**
 * The security headers of every response. The Content Security Policy allows only Gousset's own
 * files and the scripts and styles carrying the response's nonce, which ui-sdk reads from
 * `<meta property="csp-nonce">`. It is left out in development, where Vite injects scripts of its
 * own without a nonce.
 */
export function securityHeaders(options: { nonce: string; strict: boolean; https: boolean }) {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  });

  if (options.strict) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${options.nonce}'`,
        `style-src 'self' 'nonce-${options.nonce}'`,
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  }

  if (options.https) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return headers;
}
