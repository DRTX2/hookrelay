# Runbook

Each section matches an alert (`ops/observability/alerts.yml`, `infra/terraform/alarms.tf`). First step, always: open the Grafana dashboard (or CloudWatch) and check whether the problem is **ingestion** (API) or **delivery** (workers/receivers).

## failure-rate
**DeliveryFailureRateHigh: >25% of attempts failing.**
1. Is it one endpoint or many? `SELECT e.url, count(*) FROM attempts a JOIN deliveries d ON d.id=a.delivery_id JOIN endpoints e ON e.id=d.endpoint_id WHERE a.created_at > now()-interval '15 min' AND (a.status_code IS NULL OR a.status_code >= 300) GROUP BY 1 ORDER BY 2 DESC LIMIT 10;`
2. One or a few endpoints: customer-side outage. The circuit breaker disables them after `ENDPOINT_DISABLE_AFTER` failures. No action, but notify the tenant if they're important.
3. Many endpoints with `error` like `ENOTFOUND`/`ETIMEDOUT`: suspect **our egress** (NAT gateway, DNS, security group). Check NAT metrics and test from a task: `aws ecs execute-command … curl https://example.com`.
4. Errors `Refusing to connect to private address`: someone registered internal URLs. Expected and blocked.

## backlog
**QueueBacklogGrowing (>5k waiting) / worker CPU high / Redis memory high.**
1. Are workers up? `aws ecs describe-services … worker` → `runningCount`.
2. Scale out now: `aws ecs update-service --cluster hookrelay-production --service hookrelay-production-worker --desired-count 8`.
3. If receivers are slow (`hookrelay_delivery_attempt_duration_seconds` p95 high), more workers help only up to the receiver's limit. Check the slowest endpoints and consider disabling an abusive one.
4. Redis memory at 100% with `noeviction` → new enqueues fail, but messages are safe in Postgres (`pending`). The sweeper re-enqueues them once memory frees up. Don't flush Redis unless needed. If you must flush, the sweeper rebuilds the queue (expect a burst).

## api-errors
**ApiErrorRateHigh: >2% 5xx.**
1. Logs Insights: `filter message.status >= 500 | stats count() by message.path`.
2. DB connectivity (`ECONNREFUSED`, `too many clients`) → check RDS CPU/connections, task count × pool size (10).
3. Redis down → ingestion still commits to Postgres. The enqueue error is swallowed and the sweeper recovers it. Rate limiting fails closed (500). Restore Redis.
4. Bad deploy → the ECS circuit breaker should have rolled back already. If not, redeploy the previous sha (see DEPLOYMENT → Rollback).

## latency
**IngestLatencyHigh: p95 > 300 ms.**
1. API CPU high → scale `api` or check for a hot loop (event loop lag metric `hookrelay_nodejs_eventloop_lag_seconds`).
2. DB slow → Performance Insights top SQL. Usual suspects: missing index after a migration, lock waits on `endpoints` (circuit breaker writes for a failing endpoint under heavy fan-out).
3. Traces in Jaeger/X-Ray show which span grew.

## no-workers
**NoWorkers: no worker scraped.** Events are accepted but nothing is delivered.
1. `aws ecs describe-services` → events / stopped reason (bad secret, OOM, image pull).
2. A crash loop after a deploy usually means a config/secret problem. Check the task's last log lines in `/ecs/hookrelay-production/worker`.

## database
**RDS CPU >80% or storage <2 GiB.**
1. CPU: Performance Insights, look for sweeper scans (should use `deliveries_pending_idx`) or the stats query (24 h window over `attempts`).
2. Storage: `attempts` is the largest table. Apply the retention/partitioning plan (ROADMAP) or temporarily delete attempts older than N days in batches.

## Useful queries
```sql
-- delivery status of the last hour
SELECT status, count(*) FROM deliveries WHERE created_at > now() - interval '1 hour' GROUP BY 1;
-- disabled endpoints and why
SELECT id, url, disabled_reason, disabled_at FROM endpoints WHERE disabled_at IS NOT NULL ORDER BY disabled_at DESC;
-- stuck pending deliveries (sweeper should pick these up)
SELECT count(*) FROM deliveries WHERE status='pending' AND COALESCE(next_attempt_at, created_at) < now() - interval '5 minutes';
```
