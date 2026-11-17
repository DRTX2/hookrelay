# Test plan

## Strategy

```
            ┌─────────────┐   k6 load (ops/load) — capacity, SLO
            │   load      │
          ┌─┴─────────────┴─┐   8 black-box tests — real API + worker processes,
          │  integration    │   Postgres, Redis, programmable receiver
        ┌─┴─────────────────┴─┐   36 unit tests — domain, use case with fakes,
        │        unit         │   SSRF agent (incl. real DNS resolution)
        └─────────────────────┘
   + static: ESLint, tsc --strict, CodeQL, Trivy, gitleaks, SonarQube
```

The hexagonal core makes the expensive rules cheap to test: `DeliverAttempt` runs against in-memory fakes in milliseconds. The integration suite treats the system as a black box over HTTP, so it also tests the wiring that unit tests can't see (DI, SQL, queue, migrations).

## How to run

| Level | Command | Needs |
|---|---|---|
| Unit | `pnpm --filter api test` | nothing |
| Unit + coverage | `pnpm --filter api test:cov` | nothing (fails below the gate) |
| Integration | `pnpm --filter api test:int` | Postgres + Redis (`docker compose up -d postgres redis`) |
| Load | `k6 run -e API=… -e KEY=… [-e RATE=400 -e DURATION=1m] ops/load/ingest.js` | running stack, high `RATE_LIMIT_PER_MINUTE` |

The integration suite **refuses to run** unless `TEST_DATABASE_URL` ends in `_test` and Redis uses db 15. It recreates that database on each run.

## Coverage policy
- **Gate: ≥90% lines / ≥85% branches on the core** (`delivery/domain`, `delivery/application`, `ssrf.ts`). Current: 98.7% lines, 92.5% branches.
- Controllers and adapters are covered by integration tests running in child processes, which the V8 coverage of the test runner doesn't see. SonarQube excludes them from the % metric so it isn't misleading (`sonar-project.properties`). See gap G1.

## Test cases

### Unit: domain (`test/unit/domain.test.ts`)
| Area | Cases |
|---|---|
| Signing | Official Standard Webhooks vector · round trip · tampered body · wrong secret · stale timestamp (replay) · multiple signatures (rotation) |
| Backoff | Schedule with ±20% jitter bounds · clamps to last step · rejects invalid schedules |
| Decision table | 2xx → success · 410 → gone · 5xx/network → retry · last attempt → exhausted · manual resend never retries |
| SSRF | 9 private ranges blocked (incl. `::ffff:127.0.0.1`, metadata IP) · public IPs allowed · URL rules (scheme, credentials, IP literals) · **agent refuses a hostname resolving to 127.0.0.1** and allows it when explicitly enabled |

### Unit: use case (`test/unit/deliver-attempt.test.ts`)
Signed request verifiable by a receiver · stable `webhook-id` · success resets circuit · 5xx persists **before** scheduling retry · network errors keep the message · exhaustion fails the delivery · 410 trips the circuit · manual resend has no auto retry · disabled endpoint fails without calling out · stale jobs skipped (deleted row, already delivered, duplicate attempt number).

### Integration (`test/integration/api.int.test.ts`)
| # | Scenario | Asserts |
|---|---|---|
| I1 | Tenant creation | Admin token required, API key returned once, unauthenticated calls 401 |
| I2 | Contracts | Invalid body → 400. Published OpenAPI contains the validated fields |
| I3 | Signed delivery | Receiver gets the envelope and the signature verifies with the endpoint secret |
| I4 | Idempotency | Same key → 202 then 200 with the same id |
| I5 | Retry | 503, 503, 200 → attempts recorded in order, delivery succeeded |
| I6 | Circuit + resend | 3 failures disable the endpoint. Re-enable + resend succeeds |
| I7 | Metrics | Worker exposes attempt counters and queue gauges |
| I8 | Rate limit | 429 with `retry-after` once the tenant exceeds its window |

### Load (`ops/load/ingest.js`)
Constant arrival rate on `POST /v1/messages` with idempotency keys, while workers deliver at the same time. Thresholds: error rate < 1%, p95 < 300 ms. Results and analysis in [SCALABILITY](SCALABILITY.md).

## Known gaps (prioritized)
| ID | Gap | Plan |
|---|---|---|
| G1 | Integration coverage isn't measured | Run child processes with `NODE_V8_COVERAGE` and merge with `c8`/`monocart` into lcov for Sonar |
| G2 | Sweeper recovery has no automated test | Integration test: insert a `pending` delivery with no job, shorten the sweep interval via env, assert it gets delivered |
| G3 | No browser E2E for the dashboard | Playwright: send test event → see it in the live feed → resend a failed delivery |
| G4 | No contract tests for consumers | Publish the receiver verification snippet as a package with its own tests against the spec vectors |
| G5 | No chaos tests | Kill Redis during load, then assert zero lost deliveries after recovery (sweeper) |
| G6 | Security testing is static only | OWASP ZAP baseline scan against `/v1` in CI (nightly) |
