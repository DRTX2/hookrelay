# Project context (memory)

Read this first when resuming work. It records **why** things are the way they are, what was verified, and the traps already hit. Keep it current: append to the log at the bottom.

## One-paragraph summary
Hookrelay accepts events from a producer, fans them out to subscribed customer endpoints, and delivers them reliably: Standard Webhooks signatures, retries with jitter, circuit breaker, SSRF protection, idempotent ingestion, a live dashboard. Postgres is the source of truth; BullMQ/Redis only triggers attempts. The delivery core is hexagonal; CRUD is SQL-first.

## Current state (2026-11-16)
| Area | State |
|---|---|
| Features | Complete for v1 (see IMPLEMENTATION_PLAN phases 1–3) |
| Tests | 36 unit (core 98.7% lines) + 8 black-box integration, all green |
| Lint/types | ESLint + `tsc --strict` clean |
| Security scans | Trivy clean (3 accepted risks documented), workflows pass actionlint |
| Observability | Verified locally: Prometheus (all replicas), Grafana dashboard, Jaeger traces |
| Load | 400 req/s ingestion p95 3.1 ms with concurrent delivery (laptop) |
| CI/CD | Written, **not yet run on GitHub** (repo not pushed) |
| AWS | Terraform validates, **never applied** |

## Decisions you should not undo without reading the ADR
1. Delivery state in Postgres, not the queue ([0001](adr/0001-postgres-source-of-truth.md)). Don't switch to BullMQ `attempts`/`backoff`.
2. Separate worker process, **same image** as the API ([0002](adr/0002-separate-worker-process.md)).
3. SSRF check inside the connection's DNS lookup, not before `fetch` ([0003](adr/0003-ssrf-guard-at-connect-time.md)).
4. Hexagonal only in `delivery/` ([0004](adr/0004-pragmatic-hexagonal-core.md)).
5. zod contracts generate OpenAPI ([0006](adr/0006-zod-contracts-openapi.md)). Never hand-edit the spec.

## Gotchas already hit (save yourself the time)
- **NestJS 12 is ESM-only.** The project is `"type": "module"` with `NodeNext` resolution, so relative imports need `.js` extensions.
- **Decorator metadata**: TypeScript is pinned to `~5.9` (TS 7 dropped `emitDecoratorMetadata`). Vitest/esbuild doesn't emit metadata either, so Nest DI by type doesn't work inside Vitest. That's why integration tests are black-box (spawn `dist/` processes) instead of booting Nest in-process.
- **BullMQ job IDs can't contain `:`**. We use `deliveryId_attempt`.
- **Compose image drift**: api and worker once ran different images (the worker image was stale). Both now use `image: hookrelay-api:local`; rebuild `api` only.
- **Docker DNS for Prometheus** only works if the worker containers are actually running. "invalid IP" in `docker inspect` meant they had crashed.
- **OpenTelemetry**: use `--require …/register` in `NODE_OPTIONS` (works from ESM because pg/express/ioredis are CJS). ioredis v6 and Express 5 route names aren't instrumented yet.
- **Load test outlier**: one early run showed p95 1.6 s that never reproduced. Run at least 3 times before concluding anything.
- **Postgres TLS in AWS**: node-pg treats `sslmode=require` as verify-full, so the URL uses `uselibpqcompat=true` (see SECURITY pending #1).
- **Next.js 16 BFF**: `api()` calls `connection()` so pages never prerender at build time (the build has no API key).

## Where to look
| I want to… | Go to |
|---|---|
| Change retry/backoff rules | `delivery/domain/retry-policy.ts` + `test/unit/domain.test.ts` |
| Change what happens per attempt | `delivery/application/deliver-attempt.ts` + `test/unit/deliver-attempt.test.ts` |
| Add an endpoint | `contracts.ts` (schema) → controller → `openapi.ts` path → integration test |
| Add a metric | `common/metrics.ts`, panel in `ops/observability/grafana/.../hookrelay.json` |
| Add an alert | `ops/observability/alerts.yml` **and** `infra/terraform/alarms.tf` + RUNBOOK section |
| Change infra | `infra/terraform/*.tf` → `terraform fmt && terraform validate`, then Trivy |

## Local commands cheat sheet
```bash
docker compose up -d postgres redis
pnpm --filter api test && pnpm --filter api test:int && pnpm --filter api lint
docker compose up -d                                                   # full stack
OTEL_SDK_DISABLED=false docker compose --profile observability up -d   # + Grafana/Prom/Jaeger
RATE_LIMIT_PER_MINUTE=1000000 docker compose up -d --force-recreate api worker  # before k6
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest       # lint workflows
docker run --rm -v "$PWD:/repo" -w /repo aquasec/trivy:0.66.0 fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed --skip-dirs '**/node_modules' .
(cd infra/terraform && terraform fmt -check && terraform init -backend=false && terraform validate)
```

## Log
- **2026-11-16**: v1 built (engine, dashboard, receiver). Hexagonal refactor of delivery. Added metrics, JSON logs, OTel, rate limiting, helmet, OpenAPI from zod, integration suite, k6, Grafana/Prometheus/Jaeger, CI/CodeQL/deploy workflows, Terraform for AWS, docs. Next: ROADMAP "Now".
