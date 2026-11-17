import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { ApiModule } from './modules.js';
import { createPool, migrate } from './db/db.js';
import { createLogger } from './common/logger.js';
import { registry, trackQueue } from './common/metrics.js';
import { requestLogger } from './common/request-logger.js';
import { DeliveryQueue } from './delivery/infrastructure/delivery.queue.js';
import { docsHtml, openApiDocument } from './openapi.js';

const pool = createPool();
await migrate(pool);
await pool.end();

const app = await NestFactory.create<NestExpressApplication>(ApiModule, { logger: createLogger('api') });
app.enableShutdownHooks();
app.set('trust proxy', 1); // behind the ALB: real client IP and protocol
app.use(helmet({ contentSecurityPolicy: false })); // CSP off only because /docs loads Scalar from a CDN
app.useBodyParser('json', { limit: '256kb' }); // explicit payload cap (OWASP API4)
app.use(requestLogger);
app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false });

trackQueue(() => app.get(DeliveryQueue).counts());
const http = app.getHttpAdapter().getInstance();
http.get('/health', (_req: Request, res: Response) => res.send('ok'));
// shortcut: /metrics is unauthenticated; the ALB only forwards /v1, /docs and /health, so keep it internal.
http.get('/metrics', async (_req: Request, res: Response) => res.type(registry.contentType).send(await registry.metrics()));
http.get('/openapi.json', (_req: Request, res: Response) => res.json(openApiDocument));
http.get('/docs', (_req: Request, res: Response) => res.type('html').send(docsHtml));

await app.listen(Number(process.env.PORT ?? 3000));
