import type { Request, Response, NextFunction } from "express";
import { RouterError } from "../services/router.js";
import { logger } from "../logger.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof RouterError) {
    res.status(err.status).json({
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "unhandled error");
  res.status(500).json({
    ok: false,
    error: { code: "INTERNAL", message },
  });
}
