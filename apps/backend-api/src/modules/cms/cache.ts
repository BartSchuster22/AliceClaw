import Redis from 'ioredis';

const CACHE_KEY = 'cms:public';
const CACHE_TTL_SECONDS = 60 * 5;
const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';

let redis: Redis | null = null;

function getRedisClient() {
  if (!redis) {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  return redis;
}

export async function getCachedPublicCms() {
  try {
    const raw = await getRedisClient().get(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch (error) {
    console.warn('[cms] failed to read public CMS cache', error);
    return null;
  }
}

export async function setCachedPublicCms(payload: Record<string, unknown>) {
  try {
    await getRedisClient().set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
  } catch (error) {
    console.warn('[cms] failed to write public CMS cache', error);
  }
}

export async function invalidatePublicCmsCache() {
  try {
    await getRedisClient().del(CACHE_KEY);
  } catch (error) {
    console.warn('[cms] failed to invalidate public CMS cache', error);
  }
}
