type EnvValue = string | undefined;

const DEFAULT_PORT = 3000;
const DEFAULT_REDIS_HOST = 'localhost';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_RABBITMQ_URL = 'amqp://localhost:5672';
const DEFAULT_RABBITMQ_PREFETCH = 20;

interface EnvConfig {
  PORT: number;
  MONGO_URI: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  JWT_SECRET: string;
  EMAIL?: string;
  EMAIL_PASS?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RABBITMQ_URL: string;
  RABBITMQ_PREFETCH: number;
}

function requireString(
  config: Record<string, EnvValue>,
  key: keyof EnvConfig,
): string {
  const value = config[key];

  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function parseNumber(
  config: Record<string, EnvValue>,
  key: keyof EnvConfig,
  defaultValue?: number,
): number {
  const value = config[key];

  if (!value || value.trim() === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Missing required environment variable: ${key}`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }

  return parsed;
}

export function validateEnv(config: Record<string, EnvValue>): EnvConfig {
  return {
    PORT: parseNumber(config, 'PORT', DEFAULT_PORT),
    MONGO_URI: requireString(config, 'MONGO_URI'),
    REDIS_HOST: config.REDIS_HOST || DEFAULT_REDIS_HOST,
    REDIS_PORT: parseNumber(config, 'REDIS_PORT', DEFAULT_REDIS_PORT),
    JWT_SECRET: requireString(config, 'JWT_SECRET'),
    EMAIL: config.EMAIL,
    EMAIL_PASS: config.EMAIL_PASS,
    STRIPE_SECRET_KEY: requireString(config, 'STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: requireString(config, 'STRIPE_WEBHOOK_SECRET'),
    RABBITMQ_URL: config.RABBITMQ_URL || DEFAULT_RABBITMQ_URL,
    RABBITMQ_PREFETCH: parseNumber(
      config,
      'RABBITMQ_PREFETCH',
      DEFAULT_RABBITMQ_PREFETCH,
    ),
  };
}
