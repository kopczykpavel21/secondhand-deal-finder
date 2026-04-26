import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let redisPromise: Promise<RedisClient | null> | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export async function getRedisClient(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) return null;

  if (!redisPromise) {
    redisPromise = (async () => {
      const client = createClient({ url: process.env.REDIS_URL });
      client.on('error', (error) => {
        console.error('[redis] client error:', error);
      });
      if (!client.isOpen) {
        await client.connect();
      }
      return client;
    })().catch((error) => {
      redisPromise = null;
      throw error;
    });
  }

  const client = await redisPromise;
  if (client && !client.isOpen) {
    await client.connect();
  }
  return client;
}
