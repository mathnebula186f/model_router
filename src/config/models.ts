import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// models.json lives at project root so it's easy to edit without a rebuild.
const modelsPath = resolve(process.cwd(), "models.json");
const registry = JSON.parse(
  readFileSync(modelsPath, "utf-8"),
) as Record<string, ModelEntry>;

export function getModel(name: string): ModelEntry | undefined {
  return registry[name];
}

export function listModels(): string[] {
  return Object.keys(registry);
}
