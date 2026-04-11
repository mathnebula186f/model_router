import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../src/server.js";
import { connectMongo } from "../src/db/mongo.js";

// Express app is built once per container and reused across warm invocations.
const app = buildServer();

// Mongo connection is also reused across warm invocations. We cache the
// *promise* so concurrent cold-start requests share a single connect() call.
let ready: Promise<unknown> | null = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ready) {
    ready = connectMongo().catch((err) => {
      // Reset so the next invocation can retry instead of inheriting a
      // permanently-rejected promise.
      ready = null;
      throw err;
    });
  }
  await ready;

  // Express's Application type is callable as (req, res, next?) — hand the
  // raw Node request/response straight to it.
  (app as unknown as (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void)(req, res);
}
