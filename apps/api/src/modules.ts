import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createPool, PG, required } from './db/db.js';
import { EventsService } from './common/events.js';
import { ApiKeyGuard } from './common/http.js';
import { DELIVERY_QUEUE, DeliveryQueue } from './delivery/delivery.queue.js';
import { DeliveryProcessor } from './delivery/delivery.processor.js';
import { Sweeper } from './delivery/sweeper.js';
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
  providers: [ApiKeyGuard],
})
export class ApiModule {}

@Module({
  imports: [CoreModule],
  providers: [DeliveryProcessor, Sweeper],
})
export class WorkerModule {}
