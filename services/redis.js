const Redis = require('ioredis');

let connection = null;
let subscriber = null;

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  }
};

function getConnection() {
  if (!connection) {
    connection = new Redis(REDIS_CONFIG);
    connection.on('connect', () => console.log('✓ Redis connected'));
    connection.on('error', (err) => console.error('[Redis] Error:', err.message));
  }
  return connection;
}

// BullMQ needs separate connections for subscriber
function createConnection() {
  return new Redis(REDIS_CONFIG);
}

async function ping() {
  try {
    const redis = getConnection();
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

async function disconnect() {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

module.exports = { getConnection, createConnection, ping, disconnect, REDIS_CONFIG };
