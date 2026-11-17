# Implementation plan

Status legend: ✅ done and verified · 🟡 partially done · ⬜ not started. Each phase ends with a working, deployable system.

## Phase 1: Core delivery engine ✅
| Item | Status | Evidence |
|---|---|---|
| Schema + forward-only migrations under an advisory lock | ✅ | `src/db/migrations`, `db.ts` |
| Tenants with hashed API keys, admin bootstrap | ✅ | `common/http.ts`, integration test "creates a tenant" |
| Idempotent ingestion + fan-out in one transaction | ✅ | `messages.controller.ts`, integration "is idempotent" |
| Worker: signed delivery, retries with jitter, 410 handling | ✅ | `DeliverAttempt`, 9 use-case unit tests |
| Circuit breaker, manual resend | ✅ | integration "opens the circuit…" |
| Orphan sweeper (crash/Redis-loss recovery) | ✅ | `sweeper.ts` (see TEST_PLAN gap G2) |
| SSRF guard at connect time | ✅ | `ssrf.ts`, unit tests incl. DNS-resolved localhost |

## Phase 2: Product surface ✅
| Item | Status |
|---|---|
| Next.js 16 BFF dashboard: overview, live SSE feed, endpoints, message timeline, resend | ✅ |
| Stats endpoint (success rate, p50/p95, hourly series) | ✅ |
| OpenAPI 3.1 from zod + Scalar UI at `/docs` | ✅ |
| Reference receiver (`examples/receiver`) | ✅ |

## Phase 3: Production readiness ✅
| Item | Status |
|---|---|
| Hexagonal refactor of the delivery core | ✅ |
| Structured JSON logs + request ids | ✅ |
| Prometheus metrics (API + worker), Grafana dashboard, alert rules | ✅ verified with real traffic |
| OpenTelemetry tracing (HTTP, Express, pg) → Jaeger/OTLP | ✅ verified (see OBSERVABILITY gaps) |
| Per-tenant rate limiting, helmet, body size cap | ✅ |
| Black-box integration suite against real Postgres/Redis | ✅ 8 tests |
| k6 load test + measured capacity | ✅ |

## Phase 4: Delivery pipeline & cloud 🟡
| Item | Status | Next step |
|---|---|---|
| GitHub Actions CI: lint, typecheck, unit+coverage, integration, build | ✅ | actionlint passes. Needs a first push to run on GitHub |
| SonarQube job + quality gate | 🟡 | Create the SonarCloud project, set `SONAR_TOKEN` + repo var `SONAR_ENABLED=true` |
| Security: CodeQL, Trivy (deps, IaC, image), gitleaks | ✅ | Trivy runs clean locally, with accepted risks in `.trivyignore` |
| Terraform for AWS (VPC, ECS, ALB, RDS, ElastiCache, Secrets, alarms, OIDC) | ✅ | `terraform validate` passes. Never applied: needs an AWS account (see DEPLOYMENT) |
| Deploy workflow (OIDC, immutable images, approval gate, smoke test) | 🟡 | Written and linted. Run after the first `terraform apply` |
| HTTPS with ACM + custom domain | ⬜ | Set `certificate_arn` |

## Phase 5: Scale & product depth ⬜
Prioritized in [ROADMAP](ROADMAP.md): queue-depth autoscaling, wildcard event types (spec ready in `docs/specs/`), secret rotation, per-endpoint rate limiting, attempts retention/partitioning, multi-user dashboard auth, response-schema OpenAPI, end-to-end trace propagation API → worker.

## Definition of done (per feature)
1. A spec in `docs/specs/` (problem, contract, acceptance criteria) for anything non-trivial.
2. Unit tests for new rules, an integration test for new endpoints or flows.
3. Lint, typecheck and the coverage gate pass. No new Trivy HIGH/CRITICAL.
4. Metrics/logs for new failure modes. An alert and runbook entry if it can page someone.
5. Docs updated (ARCHITECTURE if the shape changed, an ADR if a trade-off was made).
