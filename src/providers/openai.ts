import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import type {
  GenerateInput,
  GenerateOutput,
  Provider,
} from "./types.js";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

export const openaiProvider: Provider = {
  name: "openai",
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const openai = getClient();
    const { providerModel, prompts, params } = input;

    const messages = prompts.map((m) => ({
      role: m.role,
      content: m.content,
    })) as ChatCompletionMessageParam[];

    const response = await openai.chat.completions.create({
      model: providerModel,
      messages,
      temperature: params?.temperature,
      max_tokens: params?.max_tokens,
      top_p: params?.top_p,
      stop: params?.stop,
      ...(params?.provider_extra ?? {}),
    });

    const choice = response.choices[0];
    const text = choice?.message?.content ?? "";
    const usage = response.usage;

    // Cached input tokens live under prompt_tokens_details.cached_tokens
    // (subset of prompt_tokens, not additive).
    const cachedTokens =
      (usage as unknown as {
        prompt_tokens_details?: { cached_tokens?: number };
      })?.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      text,
      message: { role: "assistant", content: text },
      finish_reason: choice?.finish_reason ?? "stop",
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
        cache_read_tokens: cachedTokens,
      },
      raw: response,
    };
  },
};
