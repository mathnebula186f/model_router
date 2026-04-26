import { getDb } from "./mongo.js";

export interface UsageRecord {
  _id: string;
  ts: Date;
  model: string;
  provider: string;
  provider_model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  cache_read_cost_usd: number;
  cache_write_cost_usd: number;
  total_cost_usd: number;
  latency_ms: number;
  status: "ok" | "error";
  error_code?: string;
  error_message?: string;
  params: Record<string, unknown>;
  prompt_chars: number;
  tag?: string;
}

export async function recordUsage(record: UsageRecord): Promise<void> {
  const db = getDb();
  await db.collection<UsageRecord>("usage").insertOne(record);
}
