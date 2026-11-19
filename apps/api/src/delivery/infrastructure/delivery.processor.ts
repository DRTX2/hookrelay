import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job } from 'bullmq';
import type { DeliveryJob } from '../application/ports.js';
import { DeliverAttempt } from '../application/deliver-attempt.js';
import { metrics } from '../../common/metrics.js';
import { DELIVERY_QUEUE } from './delivery.queue.js';

const tracer = trace.getTracer('hookrelay.delivery');

/** Driving adapter: BullMQ job -> use case. Everything interesting lives in DeliverAttempt. */
@Processor(DELIVERY_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 50) })
export class DeliveryProcessor extends WorkerHost {
  private readonly log = new Logger('Delivery');

  constructor(private readonly deliverAttempt: DeliverAttempt) {
    super();
  }

  /** Continues the trace of whoever scheduled the attempt (an inbound request or a previous attempt). */
  process(job: Job<DeliveryJob>): Promise<void> {
    const parent = propagation.extract(ROOT_CONTEXT, job.data.trace ?? {});
    const attributes = { 'hookrelay.delivery_id': job.data.deliveryId, 'hookrelay.attempt': job.data.attempt };
    return context.with(parent, () => tracer.startActiveSpan('hookrelay.deliver', { kind: SpanKind.CONSUMER, attributes }, async (span) => {
      try {
        await this.run(job);
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
        throw e;
      } finally {
        span.end();
      }
    }));
  }

  private async run(job: Job<DeliveryJob>): Promise<void> {
    const r = await this.deliverAttempt.execute(job.data);
    metrics.attempts.inc({ outcome: r.kind });
    if ('result' in r) {
      metrics.attemptDuration.observe({ outcome: r.kind }, r.result.durationMs / 1000);
      this.log.debug(`${job.data.deliveryId} #${job.data.attempt} -> ${r.result.statusCode ?? r.result.error} (${r.kind})`);
    }
  }
}
