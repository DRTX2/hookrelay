# Scalability

## Measured (k6, `ops/load/ingest.js`)
Setup: everything on one laptop (i7-13650HX, 20 threads, 15 GB): 1 API container, 2 worker containers × 50 concurrency delivering to the demo receiver (30% simulated failures → retries), Postgres 17, Redis 8, k6. Constant arrival rate on `POST /v1/messages`.

| Scenario | Target | Achieved | p50 | p95 | Errors |
|---|---|---|---|---|---|
| Ingestion only (workers stopped) | 200/s · 40 s | 200/s | 2.2 ms | 3.5 ms | 0 |
| Ingestion + delivery | 200/s · 2 min | 200/s | 2.4 ms | 3.9 ms | 0 |
| Ingestion + delivery | 400/s · 45 s | 400/s | 1.7 ms | 3.1 ms | 0 |
| Ingestion + delivery | 800/s · 45 s | **~740/s** (saturated) | 1.9 ms | 635 ms | 0 |

Workers kept pace: attempts per minute matched ingested messages plus retries, with no growing backlog.

**Notes on method.** The very first run showed p95 = 1.63 s at 200/s. We suspected write contention and changed the worker to a single statement per attempt, but an A/B run of the old and new write path gave the same result (~4 ms), and the 1.63 s didn't reproduce in four later runs. So it's recorded as an environmental outlier, not a fixed bug. (The single-statement write stayed, because it's simpler and atomic.) Laptop numbers are a lower bound for the design, not a production promise.

## Where it bends, in order
1. **API instance CPU/event loop (~700/s per instance here).** Stateless, so scale horizontally behind the ALB (`api` autoscaling on CPU, 2 → 6 tasks).
2. **Postgres write volume.** Per message: 1 transaction (message + N deliveries). Per attempt: 1 read + 1 write statement. At 1k msg/s × fan-out 3 with ~1.3 attempts per delivery, that's ≈ 4k writes/s, comfortable for a provisioned RDS instance (e.g. r7g.large). The pool is `max: 10` per process; tune `max × tasks` below RDS `max_connections` or add RDS Proxy.
3. **Table growth.** `attempts` grows fastest. Plan: monthly range partitioning on `created_at` and dropping old partitions (retention), so the partial `pending` index keeps the sweeper O(pending), not O(history).
4. **Redis.** BullMQ costs a few ops per job. A single node handles tens of thousands of ops/s. Memory is bounded by backlog, not history (jobs are removed on completion). `noeviction` turns memory pressure into fast failures, which the sweeper recovers from, instead of silent loss.
5. **Hot endpoints.** A failing endpoint's row is updated on each failed attempt (circuit breaker). Healthy endpoints aren't touched (the write is skipped when nothing changes). At extreme scale, move the failure streak to Redis.
6. **Receivers.** Worker throughput ≈ `concurrency / receiver latency`. 50 slots at 200 ms = 250 deliveries/s per task. Slow receivers hold slots up to the 15 s timeout, which is why circuit breaking and (pending) per-endpoint concurrency limits matter.

## Scaling plan
| Load | Changes |
|---|---|
| ≤ 500 msg/s | As deployed: 2 api, 2–10 workers (CPU), db.t4g → db.m7g as needed |
| ~2k msg/s | **Queue-depth autoscaling for workers** (publish `hookrelay_queue_jobs` to CloudWatch via EMF → step scaling); RDS Proxy; partition `attempts` |
| ~10k msg/s | Per-endpoint concurrency/rate limits (fairness between tenants); separate queues per priority/tenant tier; Redis cluster or move the trigger queue to SQS (Postgres stays the source of truth, so the swap is contained in the `RetryScheduler` adapter) |
| Beyond | Shard tenants across database clusters by `app_id`, with regional cells |

## Fairness
Today one noisy tenant can fill the shared queue. Mitigations, in order: per-tenant ingestion rate limit (done) → per-endpoint delivery concurrency → weighted queues per tenant tier.
