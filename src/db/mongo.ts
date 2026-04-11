import { MongoClient, type Db } from "mongodb";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db(env.MONGODB_DB);
  logger.info({ db: env.MONGODB_DB }, "connected to mongo");

  // Indexes — idempotent, safe to run on every boot.
  const usage = db.collection("usage");
  await usage.createIndex({ ts: -1 });
  await usage.createIndex({ model: 1, ts: -1 });
  await usage.createIndex({ status: 1, ts: -1 });

  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("Mongo not connected — call connectMongo() first");
  }
  return db;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
