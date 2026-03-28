import IORedis from 'ioredis';

let connection: IORedis | null = null;

export function getRedisConnection() {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? 'redis://redis:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy(times) {
        return Math.min(times * 200, 2000);
      },
    });

    connection.on('connect', () => {
      console.log('[worker][redis] connected');
    });

    connection.on('ready', () => {
      console.log('[worker][redis] ready');
    });

    connection.on('error', (error) => {
      console.error('[worker][redis] error', error.message);
    });

    connection.on('close', () => {
      console.warn('[worker][redis] closed');
    });

    connection.on('reconnecting', () => {
      console.warn('[worker][redis] reconnecting');
    });
  }

  return connection;
}

export async function closeRedisConnection() {
  if (connection) {
    await connection.quit().catch(async () => {
      await connection?.disconnect();
    });
    connection = null;
  }
}
