/** True for strings shaped like an OpenRouter API key (sk-or-…). */
export function looksLikeOpenRouterKey(key: string | undefined): key is string {
  return typeof key === "string" && /^sk-or-[A-Za-z0-9_-]{10,}$/.test(key.trim());
}

/** True for OpenRouter model ids such as anthropic/claude-sonnet-5.5. */
export function looksLikeModelId(model: string): boolean {
  return /^[\w.-]+\/[\w.:-]+$/.test(model);
}
