import { createClient } from 'redis';
import { promisify } from 'util';

class RedisClient {
  constructor() {
    // creates Redis client
    this.client = createClient();
    this.isClientConnected = true;

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.isClientConnected = false;
    });

    this.client.on('connect', () => {
      this.isClientConnected = true;
    });

    // promisify the methods
    this.getAsync = promisify(this.client.get).bind(this.client);
    this.setexAsync = promisify(this.client.setex).bind(this.client);
    this.delAsync = promisify(this.client.del).bind(this.client);
  }

  isAlive() {
    return this.isClientConnected;
  }

  // gets value from Redis for a given key
  async get(key) {
    return this.getAsync(key);
  }

  // sets a value in Redis with expiration
  async set(key, value, durationInSeconds) {
    return this.setexAsync(key, durationInSeconds, value);
  }

  // delete a key from Redis
  async del(key) {
    return this.delAsync(key);
  }
}

const redisClient = new RedisClient();
export default redisClient;
