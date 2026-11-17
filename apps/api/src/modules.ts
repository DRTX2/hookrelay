import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createPool, PG, required } from './db/db.js';
import { EventsService } from './common/events.js';
import { ApiKeyGuard } from './common/http.js';
import { RateLimitGuard } from './common/rate-limit.guard.js';
import { DeliverAttempt } from './delivery/application/deliver-attempt.js';
import type { DeliveryEventPublisher, DeliveryStore, RetryScheduler, WebhookSender } from './delivery/application/ports.js';
import { parseSchedule } from './delivery/domain/retry-policy.js';
import { DELIVERY_QUEUE, DeliveryQueue } from './delivery/infrastructure/delivery.queue.js';
import { DeliveryProcessor } from './delivery/infrastructure/delivery.processor.js';
import { HttpWebhookSender } from './delivery/infrastructure/http-webhook-sender.js';
import { PgDeliveryStore } from './delivery/infrastructure/pg-delivery-store.js';
import { Sweeper } from './delivery/infrastructure/sweeper.js';
import { EndpointsController } from './endpoints/endpoints.controller.js';
import { MessagesController } from './messages/messages.controller.js';
import { DeliveriesController } from './deliveries/deliveries.controller.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      // maxRetriesPerRequest: null is required by BullMQ for blocking commands
      useFactory: () => ({ connection: new Redis(required('REDIS_URL'), { maxRetriesPerRequest: null }) }),
    }),
    BullModule.registerQueue({ name: DELIVERY_QUEUE }),
  ],
  providers: [{ provide: PG, useFactory: createPool }, EventsService, DeliveryQueue],
  exports: [PG, EventsService, DeliveryQueue, BullModule],
})
export class CoreModule {}

@Module({
  imports: [CoreModule],
  controllers: [EndpointsController, MessagesController, DeliveriesController],
  providers: [ApiKeyGuard, RateLimitGuard],
})
export class ApiModule {}

/** Composition root of the delivery core: adapters are bound to the use case's ports here. */
@Module({
  imports: [CoreModule],
  providers: [
    PgDeliveryStore,
    HttpWebhookSender,
    {
      provide: DeliverAttempt,
      inject: [PgDeliveryStore, HttpWebhookSender, DeliveryQueue, EventsService],
      useFactory: (store: DeliveryStore, sender: WebhookSender, scheduler: RetryScheduler, events: DeliveryEventPublisher) =>
        new DeliverAttempt(store, sender, scheduler, events, parseSchedule(process.env.RETRY_SCHEDULE)),
    },
    DeliveryProcessor,
    Sweeper,
  ],
})
export class WorkerModule {}
