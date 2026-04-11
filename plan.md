# Model Router — Plan

A single Node/Express (TypeScript) server that accepts a POST request with a prompt payload and a secret key, routes the call to the correct LLM provider (OpenAI / Anthropic / Google Gemini), and returns a normalized response. Token usage and cost are tracked per call in MongoDB.

---

## 1. Goals

- One HTTP endpoint to call any supported LLM with a uniform request/response shape.
- Caller only needs to know **our** model name (e.g. `smart-fast`, `deep-reasoner`) — the router maps it to the real provider + model ID.
- All provider API keys and the router's own auth key live in `.env`, never in code or git.
- Every call is logged to MongoDB with token usage + computed cost.
- Provider-specific quirks (message format, param names, response shape) are isolated in adapters so adding a new provider is a single-file change.

### Non-goals for v1
- Streaming / SSE responses.
- Multimodal inputs (images, audio, files).
- Tool / function calling.
- Per-user API keys or rate limiting.
- Retry + backoff on upstream failures.

---

## 2. Tech stack

| Concern         | Choice                                    |
| --------------- | ----------------------------------------- |
| Runtime         | Node.js (LTS)                             |
| Language        | TypeScript (strict mode)                  |
| HTTP server     | Express                                   |
| Validation      | Zod (request body schema)                 |
| Env loading     | `dotenv`                                  |
| DB              | MongoDB via the official `mongodb` driver |
| Provider SDKs   | `openai`, `@anthropic-ai/sdk`, `@google/genai` |
| Logging         | `pino` (lightweight JSON logger)          |
| Dev tooling     | `tsx` for dev run, `tsc` for build        |

---

## 3. Project structure

```
model_router/
├── .env                      # local secrets (gitignored)
├── .env.example              # template, committed
├── .gitignore
├── package.json
├── tsconfig.json
├── plan.md
├── README.md
├── src/
│   ├── index.ts              # entry: loads env, starts server
│   ├── server.ts             # express app wiring (middleware, routes)
│   ├── config/
│   │   ├── env.ts            # typed env loader (fails fast if missing)
│   │   └── models.json       # model registry: our_name → provider + pricing
│   ├── middleware/
│   │   ├── auth.ts           # x-api-key check against ROUTER_SECRET_KEY
│   │   └── error.ts          # central error handler
│   ├── routes/
│   │   └── generate.ts       # POST /v1/generate
│   ├── schemas/
│   │   └── generate.schema.ts# Zod schema for request body
│   ├── providers/
│   │   ├── types.ts          # Provider interface + shared types
│   │   ├── openai.ts         # OpenAI adapter
│   │   ├── anthropic.ts      # Claude adapter
│   │   ├── gemini.ts         # Gemini adapter
│   │   └── index.ts          # resolves our model name → adapter
│   ├── services/
│   │   ├── router.ts         # orchestration: resolve model → call adapter → normalize
│   │   └── cost.ts           # compute cost from usage + models.json pricing
│   └── db/
│       ├── mongo.ts          # connection singleton
│       └── usage.ts          # insert usage/cost records
└── dist/                     # compiled output (gitignored)
```

---

## 4. API contract

### `POST /v1/generate`

**Headers**
```
Content-Type: application/json
x-api-key: <ROUTER_SECRET_KEY>
```

**Request body**
```jsonc
{
  "model": "smart-fast",              // our unique model name (see models.json)
  "prompts": [                        // chat messages, in order
    { "role": "system", "content": "You are helpful." },
    { "role": "user",   "content": "Summarize this: ..." },
    { "role": "assistant", "content": "..." },
    { "role": "user",   "content": "..." }
  ],
  "params": {                         // optional, provider-agnostic knobs
    "temperature": 0.7,
    "max_tokens": 1024,
    "top_p": 1.0,
    "stop": ["\n\n"],
    "output_config": { ... }          // claude-specific extras passed through
  }
}
```

- `prompts` is the unified message array. Roles: `system | user | assistant`.
- `params` is optional. Known keys (`temperature`, `max_tokens`, `top_p`, `stop`) are translated by each adapter to the provider's native name. Unknown keys under `params.output_config` / `params.provider_extra` are forwarded as-is so callers can use provider-specific features without the router needing to know about them.

**Success response (normalized)**
```jsonc
{
  "ok": true,
  "model": "smart-fast",              // echo of our name
  "provider": "openai",               // resolved provider
  "provider_model": "gpt-4o-mini",    // actual model ID hit
  "text": "…assistant reply…",        // convenience: concatenated text
  "message": {                        // full assistant message
    "role": "assistant",
    "content": "…assistant reply…"
  },
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  },
  "cost": {                           // computed from models.json pricing
    "input_usd": 0.0000615,
    "output_usd": 0.000684,
    "total_usd": 0.0007455
  },
  "latency_ms": 812,
  "request_id": "<uuid>"              // also the Mongo record _id
}
```

**Error response**
```jsonc
{
  "ok": false,
  "error": {
    "code": "INVALID_MODEL" | "AUTH" | "VALIDATION" | "UPSTREAM" | "INTERNAL",
    "message": "human-readable",
    "details": { ... }                // optional
  },
  "request_id": "<uuid>"
}
```

HTTP status mapping: `401` auth, `400` validation/invalid model, `502` upstream provider error, `500` internal.

---

## 5. Model registry (`src/config/models.json`)

Authoritative mapping from **our** model names to **provider** + **provider model id** + **pricing**. Pricing is kept here (not in Mongo) so it's versioned with code.

```jsonc
{
  "smart-fast": {
    "provider": "openai",
    "provider_model": "gpt-4o-mini",
    "pricing": {
      "input_per_1m_usd": 0.15,
      "output_per_1m_usd": 0.60
    },
    "defaults": { "temperature": 0.7, "max_tokens": 1024 }
  },
  "deep-reasoner": {
    "provider": "anthropic",
    "provider_model": "claude-sonnet-4-5",
    "pricing": {
      "input_per_1m_usd": 3.00,
      "output_per_1m_usd": 15.00
    },
    "defaults": { "temperature": 0.5, "max_tokens": 2048 }
  },
  "gemini-fast": {
    "provider": "google",
    "provider_model": "gemini-2.5-flash",
    "pricing": {
      "input_per_1m_usd": 0.30,
      "output_per_1m_usd": 2.50
    },
    "defaults": { "temperature": 0.7, "max_tokens": 1024 }
  }
}
```

Cost formula: `cost_usd = (prompt_tokens / 1_000_000) * input_per_1m_usd + (completion_tokens / 1_000_000) * output_per_1m_usd`. // Add caching cost also

---

## 6. Provider adapter interface

All adapters implement one interface so `router.ts` stays provider-agnostic.

```ts
// src/providers/types.ts
export type Role = "system" | "user" | "assistant";
export interface PromptMessage { role: Role; content: string; }

export interface GenerateParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  output_config?: Record<string, unknown>;  // passthrough
  provider_extra?: Record<string, unknown>; // passthrough
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
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  raw?: unknown; // kept in-memory for logging only, not returned to client
}

export interface Provider {
  name: "openai" | "anthropic" | "google";
  generate(input: GenerateInput): Promise<GenerateOutput>;
}
```

### Per-provider specifics the adapters hide

- **OpenAI** — `chat.completions.create`. `prompts` → `messages` 1:1. `max_tokens` → `max_tokens`. Usage under `response.usage.prompt_tokens / completion_tokens`.
- **Anthropic (Claude)** — `messages.create`. `system` messages must be pulled out of the array and passed as the top-level `system` param. `max_tokens` is **required**. Usage under `response.usage.input_tokens / output_tokens` (rename to `prompt_tokens` / `completion_tokens` before returning). `params.output_config` is merged into the call (e.g. `thinking`, `stop_sequences`).
- **Google Gemini** — `models.generateContent`. Messages use `{ role, parts: [{ text }] }` with role `"model"` for assistant turns (translate `assistant → model`). System prompt goes in `systemInstruction`. Usage under `response.usageMetadata.promptTokenCount / candidatesTokenCount`.

Each adapter normalizes its native response back to the `GenerateOutput` shape above.

---

## 7. Orchestration flow (`services/router.ts`)

1. `auth` middleware verifies `x-api-key === process.env.ROUTER_SECRET_KEY`.
2. Zod schema parses and validates the request body.
3. Look up `model` in `models.json`; 400 with `INVALID_MODEL` if missing.
4. Merge `registry.defaults` ← `request.params` (request wins).
5. Pick the adapter by `registry.provider`.
6. Call `adapter.generate({ providerModel, prompts, params })` wrapped in a try/catch + `performance.now()` latency timer.
7. Compute cost via `services/cost.ts` using `usage` + `registry.pricing`.
8. Insert a usage record into Mongo (fire-and-forget, awaited but failures do not fail the request — log and continue).
9. Return the normalized response.

---

## 8. MongoDB usage collection

**DB**: `model_router`  **Collection**: `usage`

```jsonc
{
  "_id": "<uuid request_id>",
  "ts": ISODate("..."),
  "model": "smart-fast",
  "provider": "openai",
  "provider_model": "gpt-4o-mini",
  "prompt_tokens": 123,
  "completion_tokens": 456,
  "total_tokens": 579,
  "input_cost_usd": 0.0000615,
  "output_cost_usd": 0.000684,
  "total_cost_usd": 0.0007455,
  "latency_ms": 812,
  "status": "ok",                    // "ok" | "error"
  "error_code": null,                // populated on failure
  "params": { "temperature": 0.7 },  // sanitized params (no prompt text)
  "prompt_chars": 842                // optional: size of prompt, not content
}
```

We deliberately do **not** store prompt or completion text by default — keeps the DB small and avoids sensitive-data concerns. Can be added later behind an env flag if needed.

Indexes: `{ ts: -1 }`, `{ model: 1, ts: -1 }`.

---

## 9. Environment variables (`.env`)

```
# Router auth — clients must send this in x-api-key
ROUTER_SECRET_KEY=replace-me

# Provider keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Mongo
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=model_router

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

`src/config/env.ts` loads these via `dotenv`, validates with Zod, and exports a typed `env` object. Missing required vars crash the process on startup (fail fast).

`.env` is gitignored; `.env.example` is committed with blank values as a template.

---

## 10. Error handling

- Zod validation errors → `400 VALIDATION` with the Zod issue list in `details`.
- Unknown model → `400 INVALID_MODEL`.
- Missing / wrong `x-api-key` → `401 AUTH`.
- Provider SDK throws (network, 4xx, 5xx) → `502 UPSTREAM` with provider's message in `details`. Error is also written to the Mongo usage record with `status: "error"` and `error_code`.
- Anything else → central error middleware returns `500 INTERNAL`, logs full stack.

Every response — success or error — includes a `request_id` (uuid) that matches the Mongo `_id` and appears in all log lines for that request.

---

## 11. Implementation phases

1. **Scaffold** — `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, folder layout, empty `index.ts` + `server.ts` that boots on `PORT`.
2. **Env + config** — `src/config/env.ts` with Zod, `models.json` with 2–3 seeded entries (one per provider).
3. **Auth middleware + schema** — `x-api-key` check, Zod schema for `POST /v1/generate`.
4. **Provider interface + OpenAI adapter** — implement one adapter end-to-end, wire through `router.ts`, return normalized response. Smoke test with curl.
5. **Anthropic adapter** — handle system-message extraction + usage rename.
6. **Gemini adapter** — handle role rename + `systemInstruction`.
7. **Mongo + cost** — connection singleton, `usage` collection, cost calc, insert on every call.
8. **Error handling polish** — central error middleware, request_id propagation, structured logs via pino.
9. **README** — how to run, env vars, sample curl for each of the three providers.

Each phase is independently runnable; after phase 4 you already have a working single-provider router.

---

## 12. Open questions / future work

- **Retries** — add exponential backoff for 429/5xx once real usage shows which providers need it.
- **Streaming** — add `stream: true` with SSE; each adapter exposes an `async *generateStream()` variant.
- **Tool calling / multimodal** — expand the `PromptMessage` shape to allow `content` to be a parts array, similar to Anthropic/Gemini native shapes.
- **Rate limiting per key** — if the router ever gets more than one client, move from a single `ROUTER_SECRET_KEY` to a `keys` collection in Mongo with per-key quotas.
- **Pricing updates** — pricing lives in `models.json`; document that it must be hand-updated when providers change rates.
