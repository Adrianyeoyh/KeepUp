import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { EventPayloadSchemas, type EventTopic, type EventPayloadMap } from './topics.js';

// ============================================
// Event Envelope — wraps every message on the bus
// ============================================
export type EventEnvelope<T = unknown> = {
  id: string;
  topic: EventTopic;
  payload: T;
  timestamp: Date;
  source: string;      // Which service published this
  traceId: string;     // For distributed tracing
};

// ============================================
// EventBus Configuration
// ============================================
export interface EventBusConfig {
  redisUrl: string;
  serviceName: string; // Identifies the publishing service
  logger?: pino.Logger;
  defaultConcurrency?: number;
}

// ============================================
// EventBus — Typed publish/subscribe over BullMQ
// ============================================
export class EventBus {
  private queues = new Map<string, Queue>();
  private workers: Worker[] = [];
  private connection: ConnectionOptions;
  private serviceName: string;
  private logger: pino.Logger;
  private defaultConcurrency: number;

  constructor(config: EventBusConfig) {
    const parsed = new URL(config.redisUrl);
    this.connection = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: parsed.pathname && parsed.pathname !== '/'
        ? Number(parsed.pathname.slice(1))
        : 0,
      maxRetriesPerRequest: null as any,
    };
    this.serviceName = config.serviceName;
    this.logger = config.logger ?? pino({ name: `event-bus:${config.serviceName}` });
    this.defaultConcurrency = config.defaultConcurrency ?? 5;
  }

  /**
   * Publish a typed event to a topic.
   * Validates the payload against the topic's Zod schema at runtime.
   */
  async publish<T extends EventTopic>(
    topic: T,
    payload: EventPayloadMap[T],
    options?: { traceId?: string },
  ): Promise<void> {
    // Validate payload
    const schema = EventPayloadSchemas[topic] as z.ZodSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error({
        topic,
        errors: parsed.error.issues,
      }, 'Event payload validation failed — not publishing');
      throw new Error(`Invalid payload for topic ${topic}: ${parsed.error.message}`);
    }

    const queue = this.getOrCreateQueue(topic);

    const envelope: EventEnvelope<EventPayloadMap[T]> = {
      id: crypto.randomUUID(),
      topic,
      payload: parsed.data,
      timestamp: new Date(),
      source: this.serviceName,
      traceId: options?.traceId ?? crypto.randomUUID(),
    };

    await queue.add(topic, envelope, {
      removeOnComplete: 200,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });

    this.logger.debug({ topic, eventId: envelope.id, traceId: envelope.traceId }, 'Event published');
  }

  /**
   * Subscribe to a topic with a typed handler.
   * Messages are automatically validated and deserialized.
   */
  subscribe<T extends EventTopic>(
    topic: T,
    handler: (payload: EventPayloadMap[T], envelope: EventEnvelope<EventPayloadMap[T]>) => Promise<void>,
    options?: { concurrency?: number },
  ): void {
    const worker = new Worker(
      topic,
      async (job) => {
        const envelope = job.data as EventEnvelope<EventPayloadMap[T]>;
        this.logger.debug({
          topic,
          eventId: envelope.id,
          traceId: envelope.traceId,
          source: envelope.source,
        }, 'Processing event');

        try {
          await handler(envelope.payload, envelope);
        } catch (err) {
          this.logger.error({
            topic,
            eventId: envelope.id,
            error: err instanceof Error ? err.message : String(err),
          }, 'Event handler failed');
          throw err; // Let BullMQ retry
        }
      },
      {
        connection: this.connection,
        concurrency: options?.concurrency ?? this.defaultConcurrency,
      },
    );

    worker.on('completed', (job) => {
      this.logger.debug({ jobId: job.id, topic }, 'Event processed');
    });

    worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, topic, error: err.message }, 'Event processing failed');
    });

    this.workers.push(worker);
    this.logger.info({ topic, concurrency: options?.concurrency ?? this.defaultConcurrency }, 'Subscribed to topic');
  }

  /**
   * Schedule a repeating job on a topic (for cron-based consumers).
   */
  async schedule<T extends EventTopic>(
    topic: T,
    payload: EventPayloadMap[T],
    options: {
      jobId: string;
      cron: string;         // Cron pattern
      removeOnComplete?: number;
    },
  ): Promise<void> {
    const queue = this.getOrCreateQueue(topic);

    const envelope: EventEnvelope<EventPayloadMap[T]> = {
      id: options.jobId,
      topic,
      payload,
      timestamp: new Date(),
      source: this.serviceName,
      traceId: `cron:${options.jobId}`,
    };

    await queue.add(options.jobId, envelope, {
      jobId: options.jobId,
      repeat: { pattern: options.cron },
      removeOnComplete: options.removeOnComplete ?? 50,
      removeOnFail: 20,
    });

    this.logger.info({ topic, jobId: options.jobId, cron: options.cron }, 'Scheduled repeating job');
  }

  /**
   * Graceful shutdown — close all workers and queues.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down event bus...');
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(
      Array.from(this.queues.values()).map((q) => q.close()),
    );
    this.logger.info('Event bus shut down');
  }

  private getOrCreateQueue(topic: string): Queue {
    if (!this.queues.has(topic)) {
      this.queues.set(topic, new Queue(topic, { connection: this.connection }));
    }
    return this.queues.get(topic)!;
  }
}
