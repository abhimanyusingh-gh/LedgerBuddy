import { Redis } from "ioredis";
import { env } from "@/config/env.js";

let client: Redis | undefined;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 100, 3000)
    });
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
