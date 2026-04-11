import type { ModelPricing } from "../config/models.js";
import type { UsageCounts } from "../providers/types.js";

export interface CostBreakdown {
  input_usd: number;
  output_usd: number;
  cache_read_usd: number;
  cache_write_usd: number;
  total_usd: number;
}

/**
 * Compute USD cost for a single call.
 *
 * `prompt_tokens` is the TOTAL input tokens (cached + uncached). We split
 * it into three buckets so cached tokens are priced at the discounted rate
 * and cache-write tokens at the premium rate (Anthropic only).
 */
export function computeCost(
  usage: UsageCounts,
  pricing: ModelPricing,
): CostBreakdown {
  const cacheRead = usage.cache_read_tokens ?? 0;
  const cacheWrite = usage.cache_write_tokens ?? 0;
  const uncached = Math.max(0, usage.prompt_tokens - cacheRead - cacheWrite);

  const input_usd = (uncached / 1_000_000) * pricing.input_per_1m_usd;
  const output_usd =
    (usage.completion_tokens / 1_000_000) * pricing.output_per_1m_usd;

  // Fall back to the base input rate if the model config doesn't declare
  // a cache rate — safer than assuming free.
  const cache_read_usd =
    (cacheRead / 1_000_000) *
    (pricing.cache_read_per_1m_usd ?? pricing.input_per_1m_usd);
  const cache_write_usd =
    (cacheWrite / 1_000_000) *
    (pricing.cache_write_per_1m_usd ?? pricing.input_per_1m_usd);

  return {
    input_usd,
    output_usd,
    cache_read_usd,
    cache_write_usd,
    total_usd: input_usd + output_usd + cache_read_usd + cache_write_usd,
  };
}
