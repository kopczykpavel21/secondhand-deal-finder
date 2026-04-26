import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let redisPromise: Promise<RedisClient | null> | null = null;
let lastRedisErrorAt = 0;

function logRedisFallback(error: unknown) {
  const now = Date.now();
  if (now - lastRedisErrorAt < 15_000) return;
  lastRedisErrorAt = now;
  console.error('[redis] falling back without Redis:', error);
}

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export async function getRedisClient(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) return null;

  if (!redisPromise) {
    redisPromise = (async (): Promise<RedisClient | null> => {
      const client = createClient({ url: process.env.REDIS_URL });
      client.on('error', (error) => {
        console.error('[redis] client error:', error);
      });
      try {
        if (!client.isOpen) {
          await client.connect();
        }
        return client;
      } catch (error) {
        await client.quit().catch(() => {});
        logRedisFallback(error);
        return null;
      }
    })().catch((error) => {
      logRedisFallback(error);
      return null;
    });
  }

  const client = await redisPromise;
  if (!client) {
    redisPromise = null;
    return null;
  }

  if (!client.isOpen) {
    try {
      await client.connect();
    } catch (error) {
      logRedisFallback(error);
      redisPromise = null;
      return null;
    }
  }
  return client;
}
