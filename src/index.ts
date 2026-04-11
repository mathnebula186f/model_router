import { env } from "./config/env.js";
import { buildServer } from "./server.js";
import { connectMongo, closeMongo } from "./db/mongo.js";
import { logger } from "./logger.js";

async function main() {
  await connectMongo();

  const app = buildServer();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "model router listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close();
    await closeMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
