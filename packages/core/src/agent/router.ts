import type { ChatMessage, LlmClient, LlmReply, ToolDefinition } from "./llm.ts";

/** What the cheaper model may touch: reading the user's own data, nothing that makes a plan. */
const READ_ONLY_TOOLS = new Set([
  "get_my_address",
  "get_balance",
  "get_token_balance",
  "list_contacts",
  "get_contact_address",
  "get_ledger_summary",
  "list_recent_transactions",
]);

const READS =
  /\b(balance|saldo|address|alamat|contacts?|kontak|crew|history|riwayat|transactions?|transaksi|recap|rekap|summary|ringkasan|spent|spend|pengeluaran|books?)\b/i;
const ACTS =
  /\b(send|sent|sending|transfer|tf|pay|paid|kirim\w*|bayar\w*|request|minta|tagih\w*|save|simpan|add|tambah\w*|delete|hapus|rename|swap|buy|sell|beli|jual|bridge|link|approve|confirm|yes|ya|ok|oke|gas|lanjut|split|real|asli|fake|palsu|scam)\b/i;
const AMOUNT = /\d+(?:[.,]\d+)?\s*\$?(?:eth|gta)\b/i;

/**
 * "light" only for a short message that plainly asks to read something. Everything else, and
 * anything that could lead to moving money, stays on the main model.
 */
export function pickModelTier(text: string): "light" | "main" {
  const t = text.trim();
  if (t.length > 80 || /0x/i.test(t) || AMOUNT.test(t) || ACTS.test(t)) return "main";
  return READS.test(t) ? "light" : "main";
}

/** Sends plain read questions to a cheaper model; falls back to the main one on any doubt. */
export class RoutedLlmClient implements LlmClient {
  constructor(
    private readonly main: LlmClient,
    private readonly light: LlmClient,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmReply> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (!last || pickModelTier(last.content) !== "light") return this.main.chat(messages, tools);
    try {
      const reply = await this.light.chat(
        messages,
        tools.filter((t) => READ_ONLY_TOOLS.has(t.function.name)),
      );
      // It was only offered read tools; a call to anything else is never run.
      const calls = reply.message.tool_calls ?? [];
      if (calls.every((c) => READ_ONLY_TOOLS.has(c.function.name))) return reply;
    } catch {
      /* the main model answers instead */
    }
    return this.main.chat(messages, tools);
  }
}
