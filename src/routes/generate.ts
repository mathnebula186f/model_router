import { Router, type Request, type Response, type NextFunction } from "express";
import { generateRequestSchema } from "../schemas/generate.schema.js";
import { routeGenerate } from "../services/router.js";

export const generateRouter = Router();

generateRouter.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = generateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Invalid request body",
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    try {
      const result = await routeGenerate(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
