import type { Contact } from "../contacts.ts";
import type { TransferDraft } from "../transfers.ts";
import type { ChatMessage, LlmClient, LlmUsage } from "./llm.ts";
import { buildSystemPrompt } from "./prompt.ts";
import {
  TOOL_DEFINITIONS,
  runTool,
  type AgentContext,
  type ContactProposal,
  type PaymentLinkOutcome,
} from "./tools.ts";
import type { UsageLog } from "./usage.ts";

export interface AgentResponse {
  /** What the agent says to the user. */
  message: string;
  /** A transfer plan waiting for the user's confirmation (render it as a confirmation card). */
  draft?: TransferDraft;
  /** A contact waiting for the user's confirmation. */
  contactProposal?: ContactProposal;
  /** A payment link the agent made this turn. */
  paymentLink?: PaymentLinkOutcome;
  /** Which tools ran this turn, for debugging and UI hints. */
  toolCalls: { name: string; ok: boolean }[];
  usage: LlmUsage & { calls: number };
}

export interface WalletAgentDeps {
  llm: LlmClient;
  ctx: AgentContext;
  model: string;
  usageLog?: UsageLog;
  /** Max model round-trips per user message. */
  maxSteps?: number;
  /** Max remembered messages (user + assistant text only). */
  maxHistory?: number;
}

const MAX_INPUT_CHARS = 2000;

export class WalletAgent {
  private history: ChatMessage[] = [];
  private readonly proposals = new Map<string, ContactProposal>();
  private readonly maxSteps: number;
  private readonly maxHistory: number;

  constructor(private readonly deps: WalletAgentDeps) {
    this.maxSteps = deps.maxSteps ?? 6;
    this.maxHistory = deps.maxHistory ?? 20;
  }

  reset(): void {
    this.history = [];
    this.proposals.clear();
  }

  async send(userText: string): Promise<AgentResponse> {
    const text = userText.trim();
    const usage = {
      promptTokens: 0,
      completionTokens: 0,
      costUsd: undefined as number | undefined,
      calls: 0,
    };
    const toolCalls: AgentResponse["toolCalls"] = [];
    if (!text) return { message: "Tell me what you'd like to do.", toolCalls, usage };
    if (text.length > MAX_INPUT_CHARS) {
      return {
        message: `That message is too long (max ${MAX_INPUT_CHARS} characters).`,
        toolCalls,
        usage,
      };
    }

    const turn: ChatMessage[] = [{ role: "user", content: text }];
    let draft: TransferDraft | undefined;
    let contactProposal: ContactProposal | undefined;
    let paymentLink: PaymentLinkOutcome | undefined;

    for (let step = 0; step < this.maxSteps; step++) {
      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(new Date(this.deps.ctx.now())) },
        ...this.history,
        ...turn,
      ];
      const reply = await this.deps.llm.chat(messages, TOOL_DEFINITIONS);
      usage.calls += 1;
      usage.promptTokens += reply.usage.promptTokens;
      usage.completionTokens += reply.usage.completionTokens;
      if (reply.usage.costUsd !== undefined)
        usage.costUsd = (usage.costUsd ?? 0) + reply.usage.costUsd;
      this.deps.usageLog?.record({
        timestamp: new Date(this.deps.ctx.now()).toISOString(),
        model: reply.model,
        promptTokens: reply.usage.promptTokens,
        completionTokens: reply.usage.completionTokens,
        costUsd: reply.usage.costUsd,
      });

      const calls = reply.message.tool_calls ?? [];
      if (calls.length === 0) {
        const message = (reply.message.content ?? "").trim() || "Done.";
        this.remember(text, message);
        const out: AgentResponse = { message, toolCalls, usage };
        if (draft) out.draft = draft;
        if (contactProposal) out.contactProposal = contactProposal;
        if (paymentLink) out.paymentLink = paymentLink;
        return out;
      }

      turn.push({ role: "assistant", content: reply.message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const outcome = await runTool(this.deps.ctx, call.function.name, call.function.arguments);
        toolCalls.push({ name: call.function.name, ok: !("error" in outcome.result) });
        if (outcome.draft) draft = outcome.draft;
        if (outcome.paymentLink) paymentLink = outcome.paymentLink;
        if (outcome.contactProposal) {
          contactProposal = outcome.contactProposal;
          this.proposals.set(contactProposal.id, contactProposal);
        }
        turn.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ tool: call.function.name, result: outcome.result }),
        });
      }
    }

    const message = "Sorry, I couldn't finish that. Could you rephrase it more simply?";
    this.remember(text, message);
    const out: AgentResponse = { message, toolCalls, usage };
    if (draft) out.draft = draft;
    if (contactProposal) out.contactProposal = contactProposal;
    if (paymentLink) out.paymentLink = paymentLink;
    return out;
  }

  /**
   * Tell the agent what happened after its plan left the conversation (sent, aborted, failed),
   * so follow-up questions make sense. Written by app code, never by the model.
   */
  noteOutcome(text: string): void {
    this.history.push({ role: "assistant", content: `[app] ${text}` });
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
  }

  /** Called by the UI/CLI when the user confirms a proposed contact. Never exposed to the model. */
  confirmContact(proposalId: string): Contact {
    const p = this.proposals.get(proposalId);
    if (!p || this.deps.ctx.now() > p.expiresAt) {
      this.proposals.delete(proposalId);
      throw new Error("That contact suggestion expired. Ask again to save it.");
    }
    this.proposals.delete(proposalId);
    return this.deps.ctx.contacts.add(p.name, p.address);
  }

  private remember(user: string, assistant: string): void {
    this.history.push({ role: "user", content: user }, { role: "assistant", content: assistant });
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
  }
}
