import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

@Injectable()
export class RedisService {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    });
  }

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
  }

  async get(key: string): Promise<JsonValue> {
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as JsonValue;
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
