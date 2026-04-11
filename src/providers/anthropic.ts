import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import type {
  GenerateInput,
  GenerateOutput,
  Provider,
} from "./types.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const anthropicProvider: Provider = {
  name: "anthropic",
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const anthropic = getClient();
    const { providerModel, prompts, params } = input;

    // Anthropic requires system messages to be hoisted out of the messages
    // array and passed as the top-level `system` param.
    const systemMessages = prompts
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const system =
      systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;

    const chat = prompts
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // max_tokens is REQUIRED by Anthropic.
    const max_tokens = params?.max_tokens ?? 1024;

    const response = await anthropic.messages.create({
      model: providerModel,
      system,
      messages: chat,
      max_tokens,
      temperature: params?.temperature,
      top_p: params?.top_p,
      stop_sequences: params?.stop,
      ...(params?.output_config ?? {}),
      ...(params?.provider_extra ?? {}),
    });

    // Collect all text blocks from the content array.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const rawUsage = response.usage as unknown as {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };

    const inputTokens = rawUsage.input_tokens ?? 0;
    const outputTokens = rawUsage.output_tokens ?? 0;
    const cacheRead = rawUsage.cache_read_input_tokens ?? 0;
    const cacheWrite = rawUsage.cache_creation_input_tokens ?? 0;

    // Anthropic's `input_tokens` excludes cached tokens, so sum them for
    // the unified `prompt_tokens` total.
    const promptTotal = inputTokens + cacheRead + cacheWrite;

    return {
      text,
      message: { role: "assistant", content: text },
      finish_reason: response.stop_reason ?? "stop",
      usage: {
        prompt_tokens: promptTotal,
        completion_tokens: outputTokens,
        total_tokens: promptTotal + outputTokens,
        cache_read_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
      },
      raw: response,
    };
  },
};
