import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './modules.js';
import { createPool, migrate } from './db/db.js';
import { createLogger } from './common/logger.js';
import { serveMetrics, trackQueue } from './common/metrics.js';
import { DeliveryQueue } from './delivery/infrastructure/delivery.queue.js';

// Separate process from the API: slow or hanging receivers can never block HTTP ingestion.
const pool = createPool();
await migrate(pool);
await pool.end();

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: createLogger('worker') });
app.enableShutdownHooks(); // drains in-flight jobs on SIGTERM (ECS stopTimeout covers the 15s HTTP timeout)
trackQueue(() => app.get(DeliveryQueue).counts());
serveMetrics(Number(process.env.METRICS_PORT ?? 9464));
