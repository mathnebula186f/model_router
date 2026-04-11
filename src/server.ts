import express from "express";
import { requireApiKey } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { generateRouter } from "./routes/generate.js";
import { listModels } from "./config/models.js";

export function buildServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Unauthenticated health probe.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, models: listModels() });
  });

  // Everything under /v1 requires the router secret key.
  app.use("/v1", requireApiKey, generateRouter);

  app.use(errorHandler);
  return app;
}
