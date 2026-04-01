import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';

function getBaseRedisOptions(): IORedis.RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
  };
}

function attachRedisLogging(connection: IORedis, label: string) {
  connection.on('connect', () => {
    console.log(`[worker][redis:${label}] connected`);
  });

  connection.on('ready', () => {
    console.log(`[worker][redis:${label}] ready`);
  });

  connection.on('error', (error) => {
    console.error(`[worker][redis:${label}] error`, error.message);
  });

  connection.on('close', () => {
    console.warn(`[worker][redis:${label}] closed`);
  });

  connection.on('reconnecting', () => {
    console.warn(`[worker][redis:${label}] reconnecting`);
  });
}

export function createRedisConnection(label: string) {
  const connection = new IORedis(redisUrl, getBaseRedisOptions());
  attachRedisLogging(connection, label);
  return connection;
}

export async function closeRedisConnection(connection: IORedis | null | undefined) {
  if (!connection) {
    return;
  }

  await connection.quit().catch(async () => {
    connection.disconnect();
  });
}
