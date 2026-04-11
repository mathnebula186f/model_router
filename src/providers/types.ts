export type Role = "system" | "user" | "assistant";

export interface PromptMessage {
  role: Role;
  content: string;
}

export interface GenerateParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  /** Provider-specific output configuration forwarded as-is (e.g. Claude `thinking`). */
  output_config?: Record<string, unknown>;
  /** Escape hatch: extra fields merged into the provider call. */
  provider_extra?: Record<string, unknown>;
}

export interface UsageCounts {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Tokens served from the provider's prompt cache (discount). */
  cache_read_tokens?: number;
  /** Tokens written to the provider's prompt cache (Anthropic only — premium). */
  cache_write_tokens?: number;
}

export interface GenerateInput {
  providerModel: string;
  prompts: PromptMessage[];
  params?: GenerateParams;
}

export interface GenerateOutput {
  text: string;
  message: PromptMessage;
  finish_reason: string;
  usage: UsageCounts;
  /** Raw provider response — kept for logs, NOT returned to clients. */
  raw?: unknown;
}

export type ProviderName = "openai" | "anthropic" | "google";

export interface Provider {
  name: ProviderName;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}
