import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    });
  }

  async set(key: string, value: unknown, ttl: number) {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
  }

  async get(key: string) {
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(data);
  }

  async delete(key: string) {
    await this.redis.del(key);
  }
}
