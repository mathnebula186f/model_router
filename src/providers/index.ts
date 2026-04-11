import type { Provider, ProviderName } from "./types.js";
import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import { geminiProvider } from "./gemini.js";

const providers: Record<ProviderName, Provider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: geminiProvider,
};

export function getProvider(name: ProviderName): Provider {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}
