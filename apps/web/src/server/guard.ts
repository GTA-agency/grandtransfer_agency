/** Request checks: only the app's own page may call the API. */

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

export type GuardFailure = { status: number; code: string; message: string };

export interface GuardOptions {
  /** Public mode: the one origin the site is served from. Local mode: null (loopback only). */
  publicOrigin: URL | null;
}

/**
 * - Host must be the site's own host (public) or a loopback name (local). A DNS-rebinding page
 *   (evil.com → our IP) sends its own host and is refused.
 * - State-changing requests need an Origin equal to that host, and POSTs need a JSON body. Other
 *   sites can't send application/json (or PATCH/DELETE) cross-origin without a CORS preflight,
 *   which this server never allows.
 */
export function checkRequest(
  req: { method: string; headers: { get(name: string): string | null } },
  opts: GuardOptions = { publicOrigin: null },
): GuardFailure | null {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const allowedHost = opts.publicOrigin
    ? host === opts.publicOrigin.host.toLowerCase()
    : LOOPBACK.test(host);
  if (!allowedHost) {
    return {
      status: 403,
      code: "FORBIDDEN_HOST",
      message: opts.publicOrigin ? "Unknown host." : "Local access only.",
    };
  }
  if (req.method === "GET" || req.method === "HEAD") return null;
  const origin = req.headers.get("origin");
  const ok = opts.publicOrigin
    ? origin === opts.publicOrigin.origin
    : (() => {
        try {
          return origin !== null && new URL(origin).host.toLowerCase() === host;
        } catch {
          return false;
        }
      })();
  if (!ok) return { status: 403, code: "FORBIDDEN_ORIGIN", message: "Cross-site request refused." };
  // POST is the only write a plain cross-site <form> can send, so it must be JSON (which forces
  // a CORS preflight we never answer). PATCH/PUT/DELETE are always preflighted by browsers.
  if (
    req.method === "POST" &&
    !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")
  ) {
    return { status: 415, code: "JSON_ONLY", message: "Send JSON." };
  }
  return null;
}
