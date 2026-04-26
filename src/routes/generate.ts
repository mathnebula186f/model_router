import { Router, type Request, type Response, type NextFunction } from "express";
import { generateRequestSchema } from "../schemas/generate.schema.js";
import { routeGenerate, RouterError } from "../services/router.js";
import { checkPrompts } from "../services/guardrail.js";

export const generateRouter = Router();

generateRouter.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = generateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        new RouterError(
          "VALIDATION",
          "Invalid request body",
          400,
          parsed.error.flatten(),
        ),
      );
    }

    const guard = checkPrompts(parsed.data.prompts);
    if (!guard.ok) {
      return next(
        new RouterError("GUARDRAIL_BLOCKED", guard.reason, 400, {
          role: guard.role,
          index: guard.index,
          matched: guard.matched,
        }),
      );
    }

    try {
      const result = await routeGenerate(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
