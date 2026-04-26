import { z } from "zod";

export const promptMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const generateParamsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: z.array(z.string()).optional(),
    output_config: z.record(z.unknown()).optional(),
    provider_extra: z.record(z.unknown()).optional(),
  })
  .optional();

export const generateRequestSchema = z.object({
  model: z.string().min(1),
  prompts: z.array(promptMessageSchema).min(1),
  params: generateParamsSchema,
  tag: z.string().min(1).max(100).optional(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
