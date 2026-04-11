import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  ROUTER_SECRET_KEY: z.string().min(1, "ROUTER_SECRET_KEY is required"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().default("model_router"),
  /**
   * Optional: inline JSON for the model registry. When set, takes priority
   * over the on-disk models.json file. Useful for serverless deploys where
   * bundling a sibling JSON file is awkward.
   */
  MODELS_JSON: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const env = parsed.data;
