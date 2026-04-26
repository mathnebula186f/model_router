import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getModel } from "../config/models.js";
import { getProvider } from "../providers/index.js";
import type {
  GenerateParams,
  PromptMessage,
} from "../providers/types.js";
import { computeCost, type CostBreakdown } from "./cost.js";
import { recordUsage } from "../db/usage.js";
import { logger } from "../logger.js";

export interface RouteRequest {
  model: string;
  prompts: PromptMessage[];
  params?: GenerateParams;
  tag?: string;
}

export class RouterError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = "RouterError";
  }
}

export interface RouteResponse {
  ok: true;
  model: string;
  provider: string;
  provider_model: string;
  text: string;
  message: PromptMessage;
  finish_reason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
  cost: CostBreakdown;
  latency_ms: number;
  request_id: string;
}

export async function routeGenerate(
  req: RouteRequest,
): Promise<RouteResponse> {
  const requestId = randomUUID();
  const started = performance.now();

  const entry = getModel(req.model);
  if (!entry) {
    throw new RouterError(
      "INVALID_MODEL",
      `Unknown model: ${req.model}`,
      400,
      { model: req.model },
    );
  }

  // Registry defaults < request params (request wins).
  const mergedParams: GenerateParams = {
    ...(entry.defaults as GenerateParams | undefined),
    ...req.params,
  };

  const provider = getProvider(entry.provider);
  const promptChars = req.prompts.reduce((n, m) => n + m.content.length, 0);

  try {
    const result = await provider.generate({
      providerModel: entry.provider_model,
      prompts: req.prompts,
      params: mergedParams,
    });

    const latency_ms = Math.round(performance.now() - started);
    const cost = computeCost(result.usage, entry.pricing);

    await recordUsage({
      _id: requestId,
      ts: new Date(),
      model: req.model,
      provider: entry.provider,
      provider_model: entry.provider_model,
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
      total_tokens: result.usage.total_tokens,
      cache_read_tokens: result.usage.cache_read_tokens ?? 0,
      cache_write_tokens: result.usage.cache_write_tokens ?? 0,
      input_cost_usd: cost.input_usd,
      output_cost_usd: cost.output_usd,
      cache_read_cost_usd: cost.cache_read_usd,
      cache_write_cost_usd: cost.cache_write_usd,
      total_cost_usd: cost.total_usd,
      latency_ms,
      status: "ok",
      params: sanitizeParams(mergedParams),
      prompt_chars: promptChars,
      tag: req.tag,
    }).catch((err) =>
      logger.error({ err, requestId }, "failed to record usage"),
    );

    return {
      ok: true,
      model: req.model,
      provider: entry.provider,
      provider_model: entry.provider_model,
      text: result.text,
      message: result.message,
      finish_reason: result.finish_reason,
      usage: {
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
        total_tokens: result.usage.total_tokens,
        cache_read_tokens: result.usage.cache_read_tokens ?? 0,
        cache_write_tokens: result.usage.cache_write_tokens ?? 0,
      },
      cost,
      latency_ms,
      request_id: requestId,
    };
  } catch (err) {
    const latency_ms = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);

    await recordUsage({
      _id: requestId,
      ts: new Date(),
      model: req.model,
      provider: entry.provider,
      provider_model: entry.provider_model,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      input_cost_usd: 0,
      output_cost_usd: 0,
      cache_read_cost_usd: 0,
      cache_write_cost_usd: 0,
      total_cost_usd: 0,
      latency_ms,
      status: "error",
      error_code: "UPSTREAM",
      error_message: message,
      params: sanitizeParams(mergedParams),
      prompt_chars: promptChars,
      tag: req.tag,
    }).catch((e) =>
      logger.error({ err: e, requestId }, "failed to record usage error"),
    );

    if (err instanceof RouterError) throw err;
    throw new RouterError("UPSTREAM", message, 502, {
      provider: entry.provider,
      request_id: requestId,
    });
  }
}

function sanitizeParams(p: GenerateParams): Record<string, unknown> {
  // Deliberately exclude free-text `output_config` / `provider_extra`
  // from Mongo so we don't accidentally persist sensitive content.
  const { temperature, max_tokens, top_p, stop } = p;
  return { temperature, max_tokens, top_p, stop };
}
