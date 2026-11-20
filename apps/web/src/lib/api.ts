import type { ApiErrorBody } from "@/shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Listener = () => void;
const lockedListeners = new Set<Listener>();
/** Called whenever the server says the session is gone (idle timeout or locked elsewhere). */
export function onLocked(fn: Listener): () => void {
  lockedListeners.add(fn);
  return () => lockedListeners.delete(fn);
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    body: init.body === undefined ? null : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | undefined)?.error;
    if (res.status === 401 && e?.code === "SESSION_REQUIRED") lockedListeners.forEach((f) => f());
    throw new ApiError(
      res.status,
      e?.code ?? "HTTP_" + res.status,
      e?.message ?? "The server didn't answer properly.",
      e?.details,
    );
  }
  return data as T;
}

export const errorMessage = (err: unknown): string =>
  err instanceof ApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : "Something went wrong.";
