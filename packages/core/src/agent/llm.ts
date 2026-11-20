/** OpenAI-compatible chat types (the subset OpenRouter tool calling needs). */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  /** USD, when the provider reports it. */
  costUsd: number | undefined;
}

export interface LlmReply {
  message: Extract<ChatMessage, { role: "assistant" }>;
  usage: LlmUsage;
  model: string;
}

export interface LlmClient {
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmReply>;
}

export type LlmErrorCode =
  | "NO_API_KEY"
  | "UNAUTHORIZED"
  | "OUT_OF_CREDITS"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "BAD_RESPONSE";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface OpenRouterOptions {
  apiKey: string | undefined;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class OpenRouterClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: OpenRouterOptions) {
    this.baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 2;
    // Wrapped, not stored bare: Cloudflare Workers reject `this.fetchFn(...)` (Illegal invocation)
    // when the global fetch is called with another object as `this`.
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmReply> {
    if (!this.opts.apiKey) {
      throw new LlmError("NO_API_KEY", "OPENROUTER_API_KEY is not set. Add it to your .env file.");
    }
    const body = JSON.stringify({
      model: this.opts.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
      usage: { include: true },
    });

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "Grand Transfer Agent",
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const timedOut =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        if (attempt < this.maxRetries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw timedOut
          ? new LlmError("TIMEOUT", "The AI service took too long to answer. Try again.")
          : new LlmError("UPSTREAM_ERROR", "Couldn't reach the AI service. Check your connection.");
      }

      if (res.ok) return this.parse(await res.json());

      const detail = await safeErrorMessage(res);
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt),
        );
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new LlmError(
          "UNAUTHORIZED",
          "OpenRouter rejected the API key. Check OPENROUTER_API_KEY.",
        );
      }
      if (res.status === 402) {
        throw new LlmError(
          "OUT_OF_CREDITS",
          "Your OpenRouter credits ran out. Top up at openrouter.ai.",
        );
      }
      if (res.status === 429) {
        throw new LlmError(
          "RATE_LIMITED",
          "The AI service is rate limiting us. Wait a moment and try again.",
        );
      }
      throw new LlmError(
        "UPSTREAM_ERROR",
        `AI service error (${res.status})${detail ? `: ${detail}` : ""}.`,
      );
    }
  }

  private parse(json: unknown): LlmReply {
    const j = json as {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { message?: string };
    };
    if (j.error)
      throw new LlmError("UPSTREAM_ERROR", `AI service error: ${j.error.message ?? "unknown"}.`);
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new LlmError("BAD_RESPONSE", "The AI service sent an empty response.");
    const message: LlmReply["message"] = { role: "assistant", content: msg.content ?? null };
    if (msg.tool_calls?.length) message.tool_calls = msg.tool_calls;
    return {
      message,
      model: j.model ?? this.opts.model,
      usage: {
        promptTokens: j.usage?.prompt_tokens ?? 0,
        completionTokens: j.usage?.completion_tokens ?? 0,
        costUsd: typeof j.usage?.cost === "number" ? j.usage.cost : undefined,
      },
    };
  }
}

function backoff(attempt: number): number {
  return 1000 * 2 ** attempt;
}

async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return (j.error?.message ?? "").slice(0, 200);
  } catch {
    return "";
  }
}
