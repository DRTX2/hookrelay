import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './modules.js';
import { createPool, migrate } from './db/db.js';

// Separate process from the API: slow or hanging receivers can never block HTTP ingestion.
const pool = createPool();
await migrate(pool);
await pool.end();

const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks(); // drains in-flight jobs on SIGTERM
