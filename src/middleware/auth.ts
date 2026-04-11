import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = req.header("x-api-key");
  if (!key || key !== env.ROUTER_SECRET_KEY) {
    res.status(401).json({
      ok: false,
      error: { code: "AUTH", message: "Missing or invalid x-api-key" },
    });
    return;
  }
  next();
}
