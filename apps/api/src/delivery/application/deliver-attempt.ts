import { decide, type Outcome } from '../domain/retry-policy.js';
import { signedHeaders } from '../domain/signing.js';
import type {
  DeliveryEventPublisher, DeliveryJob, DeliveryStore, RetryScheduler, SendResult, WebhookSender,
} from './ports.js';

export type AttemptResult =
  | { kind: 'skipped' } // stale/duplicate job: sweeper race, resend already ran, row deleted
  | { kind: 'endpoint-disabled' }
  | { kind: Outcome['kind']; result: SendResult };

/**
 * Use case: perform one delivery attempt and decide what happens next.
 * Framework-free on purpose (no Nest, no SQL, no HTTP client) so every branch is unit tested with fakes.
 */
export class DeliverAttempt {
  constructor(
    private readonly store: DeliveryStore,
    private readonly sender: WebhookSender,
    private readonly scheduler: RetryScheduler,
    private readonly events: DeliveryEventPublisher,
    private readonly schedule: number[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute({ deliveryId, attempt, manual = false }: DeliveryJob): Promise<AttemptResult> {
    const d = await this.store.load(deliveryId);
    if (!d || d.status !== 'pending' || d.attemptCount + 1 !== attempt) return { kind: 'skipped' };

    if (d.endpointDisabled) {
      await this.store.failBecauseEndpointDisabled(deliveryId);
      return { kind: 'endpoint-disabled' };
    }

    // Standard Webhooks envelope; webhook-id stays the message id on every retry so receivers can dedupe.
    const body = JSON.stringify({ type: d.eventType, timestamp: d.messageCreatedAt, data: d.payload });
    const result = await this.sender.send(d.url, body, {
      'content-type': 'application/json',
      'user-agent': 'Hookrelay/1.0',
      ...signedHeaders(d.secret, d.messageId, body, this.now().getTime()),
    });

    const outcome = decide(result.statusCode, attempt, manual, this.schedule);
    const status = outcome.kind === 'success' ? 'succeeded' : outcome.kind === 'retry' ? 'pending' : 'failed';
    const nextAttemptAt = outcome.kind === 'retry' ? new Date(this.now().getTime() + outcome.delayMs) : null;
    const lastError = result.error ?? (outcome.kind === 'success' ? null : `HTTP ${result.statusCode}`);

    // Persist before scheduling: if we crash in between, the sweeper re-enqueues from the database.
    await this.store.recordAttempt({ deliveryId, endpointId: d.endpointId, attempt, outcome: outcome.kind, result, status, nextAttemptAt, lastError });
    if (outcome.kind === 'retry') await this.scheduler.schedule([{ deliveryId, attempt: attempt + 1 }], outcome.delayMs);

    this.events.publish({
      appId: d.appId, deliveryId, messageId: d.messageId, endpointId: d.endpointId, status,
      attemptNo: attempt, statusCode: result.statusCode, durationMs: result.durationMs, at: this.now().toISOString(),
    });
    return { kind: outcome.kind, result };
  }
}
