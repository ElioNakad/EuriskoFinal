declare module 'amqplib' {
  export interface ConsumeMessage {
    content: Buffer;
  }

  export interface Channel {
    assertExchange(
      exchange: string,
      type: string,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    assertQueue(queue: string, options?: Record<string, unknown>): Promise<unknown>;
    bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown>;
    prefetch(count: number): Promise<unknown>;
    publish(
      exchange: string,
      routingKey: string,
      content: Buffer,
      options?: Record<string, unknown>,
    ): boolean;
    consume(
      queue: string,
      onMessage: (message: ConsumeMessage | null) => void,
    ): Promise<unknown>;
    ack(message: ConsumeMessage): void;
    nack(message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean): void;
    close(): Promise<void>;
  }

  export interface Connection {
    createChannel(): Promise<Channel>;
    close(): Promise<void>;
  }

  export function connect(url: string): Promise<Connection>;
}

