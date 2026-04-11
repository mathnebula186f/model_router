import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env.js";
import type { ProviderName } from "../providers/types.js";

export interface ModelPricing {
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  cache_read_per_1m_usd?: number;
  cache_write_per_1m_usd?: number;
}

export interface ModelEntry {
  provider: ProviderName;
  provider_model: string;
  pricing: ModelPricing;
  defaults?: Record<string, unknown>;
}

function loadRegistry(): Record<string, ModelEntry> {
  // 1. Prefer inline env var if set — required for serverless deploys
  //    (Vercel etc.) where bundling a sibling JSON file is awkward.
  if (env.MODELS_JSON) {
    try {
      return JSON.parse(env.MODELS_JSON) as Record<string, ModelEntry>;
    } catch (err) {
      throw new Error(
        `MODELS_JSON env var is set but could not be parsed as JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // 2. Fall back to models.json at the project root (local dev default).
  const modelsPath = resolve(process.cwd(), "models.json");
  return JSON.parse(
    readFileSync(modelsPath, "utf-8"),
  ) as Record<string, ModelEntry>;
}

const registry = loadRegistry();

export function getModel(name: string): ModelEntry | undefined {
  return registry[name];
}

export function listModels(): string[] {
  return Object.keys(registry);
}
