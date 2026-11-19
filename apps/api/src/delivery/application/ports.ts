import type { Outcome } from '../domain/retry-policy.js';

/**
 * Ports of the delivery core. The use case depends only on these interfaces; Postgres,
 * undici, BullMQ and Redis live behind them in ../infrastructure (hexagonal architecture).
 */

export type DeliveryStatus = 'pending' | 'succeeded' | 'failed';

export interface DeliveryJob {
  deliveryId: string;
  attempt: number;
  manual?: boolean;
  /** W3C trace context of whoever scheduled the attempt, so the delivery continues the caller's trace. */
  trace?: Record<string, string>;
}

export interface DeliveryContext {
  deliveryId: string;
  status: DeliveryStatus;
  attemptCount: number;
  messageId: string;
  endpointId: string;
  appId: string;
  url: string;
  secret: string;
  endpointDisabled: boolean;
  eventType: string;
  payload: unknown;
  messageCreatedAt: Date;
}

export interface SendResult {
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
}

export interface AttemptRecord {
  deliveryId: string;
  endpointId: string;
  attempt: number;
  /** Also drives the endpoint's circuit breaker, in the same atomic write. */
  outcome: Outcome['kind'];
  result: SendResult;
  status: DeliveryStatus;
  nextAttemptAt: Date | null;
  lastError: string | null;
}

export interface DeliveryStore {
  load(deliveryId: string): Promise<DeliveryContext | null>;
  failBecauseEndpointDisabled(deliveryId: string): Promise<void>;
  /** Attempt row + delivery state + circuit breaker, atomically. */
  recordAttempt(record: AttemptRecord): Promise<void>;
}

export interface WebhookSender {
  send(url: string, body: string, headers: Record<string, string>): Promise<SendResult>;
}

export interface RetryScheduler {
  schedule(jobs: DeliveryJob[], delayMs?: number): Promise<void>;
}

export interface DeliveryEvent {
  appId: string;
  deliveryId: string;
  messageId: string;
  endpointId: string;
  status: DeliveryStatus;
  attemptNo: number;
  statusCode: number | null;
  durationMs: number;
  at: string;
}

export interface DeliveryEventPublisher {
  publish(event: DeliveryEvent): void;
}
