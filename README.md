# model-router

A minimal Express + TypeScript server that routes LLM calls across **OpenAI**, **Anthropic**, and **Google Gemini** behind a single HTTP endpoint. One normalized request/response shape, one API key for your clients, per-call token usage and cost tracked in MongoDB.

---

## What it does

- Your clients call **one** endpoint (`POST /v1/generate`) with a unified prompt shape.
- The router looks up your model alias (e.g. `smart-fast`) in `models.json`, resolves it to a provider + real model ID, and calls the right SDK.
- Provider-specific quirks (Claude's hoisted `system` param, Gemini's `model` role, OpenAI's flat `messages` array) are hidden inside per-provider adapters.
- Every call is logged to MongoDB with token counts, cached-token counts, cost breakdown, latency, and status.
- Provider API keys and the router's own auth key live in `.env`, never in code.

### Non-goals (v1)

- Streaming / SSE responses
- Multimodal inputs (images, audio, files)
- Tool / function calling
- Per-user API keys or rate limiting
- Retries + backoff on upstream failures

See [`plan.md`](./plan.md) for the full design doc.

---

## Quick start

### 1. Prerequisites

- Node.js 20 or newer
- A running MongoDB instance (local or Atlas)
- API keys for whichever providers you want to use (OpenAI, Anthropic, Google)

### 2. Install

```bash
git clone https://github.com/mathnebula186f/model_router.git
cd model_router
npm install
```

### 3. Configure `.env`

Copy the template and fill in your values:

```bash
cp .env.example .env
```

```env
# Router auth — clients must send this in the x-api-key header
ROUTER_SECRET_KEY=pick-a-long-random-string

# Provider keys (only set the ones you need)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Mongo
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=model_router

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### 4. Create `models.json`

`models.json` lives at the project root and is **not** committed (it's gitignored). Create it by hand — this is where you map your own model aliases to real provider models and declare pricing:

```json
{
  "smart-fast": {
    "provider": "openai",
    "provider_model": "gpt-4o-mini",
    "pricing": {
      "input_per_1m_usd": 0.15,
      "output_per_1m_usd": 0.60,
      "cache_read_per_1m_usd": 0.075
    },
    "defaults": { "temperature": 0.7, "max_tokens": 1024 }
  },
  "deep-reasoner": {
    "provider": "anthropic",
    "provider_model": "claude-sonnet-4-5",
    "pricing": {
      "input_per_1m_usd": 3.00,
      "output_per_1m_usd": 15.00,
      "cache_write_per_1m_usd": 3.75,
      "cache_read_per_1m_usd": 0.30
    },
    "defaults": { "temperature": 0.5, "max_tokens": 2048 }
  },
  "gemini-fast": {
    "provider": "google",
    "provider_model": "gemini-2.5-flash",
    "pricing": {
      "input_per_1m_usd": 0.30,
      "output_per_1m_usd": 2.50,
      "cache_read_per_1m_usd": 0.075
    },
    "defaults": { "temperature": 0.7, "max_tokens": 1024 }
  }
}
```

Pricing units are **USD per 1M tokens** (matches how providers publish rates). `cache_read_per_1m_usd` and `cache_write_per_1m_usd` are optional — if omitted, cached tokens fall back to the base input rate.

### 5. Run

```bash
# Dev (auto-reload via tsx watch)
npm run dev

# Production build
npm run build
npm start

# Typecheck only
npm run typecheck
```

You should see:

```
{"level":30,"time":...,"db":"model_router","msg":"connected to mongo"}
{"level":30,"time":...,"port":3000,"msg":"model router listening"}
```

---

## API

### `GET /health`

No auth. Returns `{ ok: true, models: [...] }` — useful for readiness checks and discovering what aliases are loaded.

### `POST /v1/generate`

**Headers**

| Header         | Required | Value                                  |
| -------------- | -------- | -------------------------------------- |
| `Content-Type` | yes      | `application/json`                     |
| `x-api-key`    | yes      | Must match `ROUTER_SECRET_KEY` in env  |

**Request body**

```jsonc
{
  "model": "smart-fast",
  "prompts": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user",   "content": "Summarize the French Revolution in 3 bullets." }
  ],
  "params": {
    "temperature": 0.7,
    "max_tokens": 512,
    "top_p": 1.0,
    "stop": ["\n\n"],
    "output_config": { },   // optional, forwarded as-is (e.g. Claude `thinking`)
    "provider_extra": { }   // optional escape hatch, merged into the provider call
  }
}
```

- `prompts[].role` must be `system` | `user` | `assistant`.
- `params` is optional. Known keys (`temperature`, `max_tokens`, `top_p`, `stop`) are translated to each provider's native parameter names. Unknown fields go through `output_config` / `provider_extra` untouched.
- Registry `defaults` are applied first, then your request params override them.

**Success response** (normalized across all providers)

```jsonc
{
  "ok": true,
  "model": "smart-fast",
  "provider": "openai",
  "provider_model": "gpt-4o-mini",
  "text": "- ...\n- ...\n- ...",
  "message": { "role": "assistant", "content": "- ...\n- ...\n- ..." },
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 98,
    "total_tokens": 140,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0
  },
  "cost": {
    "input_usd": 0.0000063,
    "output_usd": 0.0000588,
    "cache_read_usd": 0,
    "cache_write_usd": 0,
    "total_usd": 0.0000651
  },
  "latency_ms": 812,
  "request_id": "9b2c…-…"
}
```

**Error response**

```jsonc
{
  "ok": false,
  "error": {
    "code": "INVALID_MODEL" | "AUTH" | "VALIDATION" | "UPSTREAM" | "INTERNAL",
    "message": "human-readable",
    "details": { }
  }
}
```

| HTTP | Code            | When                                           |
| ---- | --------------- | ---------------------------------------------- |
| 400  | `VALIDATION`    | Zod rejected the body                          |
| 400  | `INVALID_MODEL` | `model` isn't in `models.json`                 |
| 401  | `AUTH`          | Missing or wrong `x-api-key`                   |
| 502  | `UPSTREAM`      | Provider SDK threw (network, 4xx, 5xx)         |
| 500  | `INTERNAL`      | Unhandled exception                            |

---

## Examples

### OpenAI (`smart-fast`)

```bash
curl -X POST http://localhost:3000/v1/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ROUTER_SECRET_KEY" \
  -d '{
    "model": "smart-fast",
    "prompts": [
      { "role": "user", "content": "Write a haiku about TypeScript." }
    ]
  }'
```

### Anthropic (`deep-reasoner`)

```bash
curl -X POST http://localhost:3000/v1/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ROUTER_SECRET_KEY" \
  -d '{
    "model": "deep-reasoner",
    "prompts": [
      { "role": "system", "content": "You answer in exactly one sentence." },
      { "role": "user",   "content": "Why is the sky blue?" }
    ],
    "params": { "max_tokens": 200, "temperature": 0.3 }
  }'
```

### Google Gemini (`gemini-fast`)

```bash
curl -X POST http://localhost:3000/v1/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ROUTER_SECRET_KEY" \
  -d '{
    "model": "gemini-fast",
    "prompts": [
      { "role": "user", "content": "Give me 5 creative project names for a model router." }
    ]
  }'
```

---

## Adding a new model

Just add a new entry to `models.json`. No code changes needed as long as the provider is one of the three already supported.

```jsonc
"my-alias": {
  "provider": "openai",              // or "anthropic" | "google"
  "provider_model": "gpt-4o",        // real model ID at the provider
  "pricing": {
    "input_per_1m_usd": 2.50,
    "output_per_1m_usd": 10.00,
    "cache_read_per_1m_usd": 1.25
  },
  "defaults": { "temperature": 0.5, "max_tokens": 4096 }
}
```

Restart the server (or wait for `tsx watch` to pick it up) and `POST` with `"model": "my-alias"`.

### Adding a new provider

1. Create `src/providers/<name>.ts` exporting a `Provider` object that implements the interface in `src/providers/types.ts`.
2. Register it in `src/providers/index.ts`.
3. Add `"<name>"` to the `ProviderName` union in `src/providers/types.ts`.
4. Add entries to `models.json` with `"provider": "<name>"`.

---

## Usage tracking (MongoDB)

Every call — success **or** error — writes one document to `model_router.usage`:

```jsonc
{
  "_id": "<uuid request_id>",
  "ts": "2026-04-11T10:32:11.812Z",
  "model": "smart-fast",
  "provider": "openai",
  "provider_model": "gpt-4o-mini",
  "prompt_tokens": 42,
  "completion_tokens": 98,
  "total_tokens": 140,
  "cache_read_tokens": 0,
  "cache_write_tokens": 0,
  "input_cost_usd": 0.0000063,
  "output_cost_usd": 0.0000588,
  "cache_read_cost_usd": 0,
  "cache_write_cost_usd": 0,
  "total_cost_usd": 0.0000651,
  "latency_ms": 812,
  "status": "ok",
  "params": { "temperature": 0.7, "max_tokens": 512 },
  "prompt_chars": 87
}
```

Indexes created automatically on boot: `{ ts: -1 }`, `{ model: 1, ts: -1 }`, `{ status: 1, ts: -1 }`.

**Prompt and completion text are NOT stored** — only the character count of the prompt. This keeps the collection small and avoids persisting sensitive user content by default. If you need full prompt logging, extend `recordUsage` in `src/db/usage.ts`.

A usage-write failure never fails the API request — it's logged and swallowed so a Mongo blip doesn't take the router down.

---

## Project layout

```
model_router/
├── .env.example              # template for .env (committed)
├── models.json               # model registry + pricing (NOT committed)
├── package.json
├── tsconfig.json
├── plan.md                   # design doc
├── README.md
└── src/
    ├── index.ts              # entry: loads env, connects Mongo, starts server
    ├── server.ts             # express app wiring
    ├── logger.ts             # pino instance
    ├── config/
    │   ├── env.ts            # zod-validated env loader (fail fast)
    │   └── models.ts         # reads models.json from process.cwd()
    ├── middleware/
    │   ├── auth.ts           # x-api-key check
    │   └── error.ts          # central RouterError → JSON mapper
    ├── schemas/
    │   └── generate.schema.ts# zod schema for the request body
    ├── routes/
    │   └── generate.ts       # POST /v1/generate handler
    ├── providers/
    │   ├── types.ts          # Provider interface + shared types
    │   ├── openai.ts         # OpenAI adapter
    │   ├── anthropic.ts      # Claude adapter (hoists system, sums cached tokens)
    │   ├── gemini.ts         # Gemini adapter (renames assistant → model)
    │   └── index.ts          # provider registry
    ├── services/
    │   ├── router.ts         # orchestration + RouterError + usage logging
    │   └── cost.ts           # cost math (splits uncached / cache-read / cache-write)
    └── db/
        ├── mongo.ts          # connection singleton + indexes
        └── usage.ts          # usage collection insert
```

---

## How caching cost is computed

Providers return token usage in slightly different shapes, so each adapter normalizes them into three buckets:

| Bucket              | OpenAI                                  | Anthropic                          | Gemini                               |
| ------------------- | --------------------------------------- | ---------------------------------- | ------------------------------------ |
| `prompt_tokens`     | `usage.prompt_tokens` (includes cached) | `input + cache_read + cache_write` | `promptTokenCount` (includes cached) |
| `cache_read_tokens` | `prompt_tokens_details.cached_tokens`   | `cache_read_input_tokens`          | `cachedContentTokenCount`            |
| `cache_write_tokens`| n/a                                     | `cache_creation_input_tokens`      | n/a                                  |

Cost is then:

```
uncached = prompt_tokens - cache_read_tokens - cache_write_tokens

input_usd       = uncached           * input_per_1m_usd       / 1e6
output_usd      = completion_tokens  * output_per_1m_usd      / 1e6
cache_read_usd  = cache_read_tokens  * cache_read_per_1m_usd  / 1e6
cache_write_usd = cache_write_tokens * cache_write_per_1m_usd / 1e6
total_usd       = sum of the four
```

If a model's pricing block doesn't declare a cache rate, cached tokens are charged at the base `input_per_1m_usd` (safer than assuming free).

---

## Scripts

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Run with `tsx watch` (auto-reload on save)     |
| `npm run build`     | Compile TypeScript to `dist/`                  |
| `npm start`         | Run the compiled server from `dist/`           |
| `npm run typecheck` | `tsc --noEmit` — strict typecheck, no output   |
