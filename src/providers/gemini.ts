import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import type {
  GenerateInput,
  GenerateOutput,
  Provider,
} from "./types.js";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set");
  }
  if (!client) client = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
  return client;
}

export const geminiProvider: Provider = {
  name: "google",
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const ai = getClient();
    const { providerModel, prompts, params } = input;

    // System prompts go in `systemInstruction`, not in `contents`.
    const systemMessages = prompts
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const systemInstruction =
      systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;

    // Gemini calls assistant turns "model"; translate here.
    const contents = prompts
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const response = await ai.models.generateContent({
      model: providerModel,
      contents,
      config: {
        systemInstruction,
        temperature: params?.temperature,
        maxOutputTokens: params?.max_tokens,
        topP: params?.top_p,
        stopSequences: params?.stop,
        ...(params?.output_config ?? {}),
        ...(params?.provider_extra ?? {}),
      },
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .map((p: { text?: string }) => p.text ?? "")
      .join("");
    const finishReason = candidate?.finishReason ?? "stop";

    const meta = response.usageMetadata;
    const promptTokens = meta?.promptTokenCount ?? 0;
    const completionTokens = meta?.candidatesTokenCount ?? 0;
    const cacheRead = meta?.cachedContentTokenCount ?? 0;
    const total = meta?.totalTokenCount ?? promptTokens + completionTokens;

    return {
      text,
      message: { role: "assistant", content: text },
      finish_reason: String(finishReason),
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: total,
        cache_read_tokens: cacheRead,
      },
      raw: response,
    };
  },
};
