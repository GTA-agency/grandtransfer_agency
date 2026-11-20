/** True for errors that mean "couldn't talk to the node / API", as opposed to a real answer. */
export function isNetworkError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const o = e as { name?: string; code?: string | number; message?: string; cause?: unknown };
    if (
      o.name === "HttpRequestError" ||
      o.name === "TimeoutError" ||
      o.name === "WebSocketRequestError" ||
      o.name === "AbortError" ||
      o.name === "ConnectTimeoutError" ||
      o.name === "LimitExceededRpcError" ||
      (typeof o.code === "string" &&
        [
          "ECONNREFUSED",
          "ECONNRESET",
          "ENOTFOUND",
          "ETIMEDOUT",
          "EAI_AGAIN",
          "UND_ERR_CONNECT_TIMEOUT",
        ].includes(o.code)) ||
      (typeof o.message === "string" &&
        /fetch failed|network|socket hang up|timed? ?out/i.test(o.message))
    ) {
      return true;
    }
    e = o.cause;
  }
  return false;
}
