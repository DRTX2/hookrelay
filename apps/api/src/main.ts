import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from './modules.js';
import { createPool, migrate } from './db/db.js';

const pool = createPool();
await migrate(pool);
await pool.end();

const app = await NestFactory.create(ApiModule);
app.enableShutdownHooks();
app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false });
app.getHttpAdapter().get('/health', (_req: unknown, res: { send: (b: string) => void }) => res.send('ok'));
await app.listen(Number(process.env.PORT ?? 3000));
