# Roadmap (pending work, prioritized)

Effort: S < 1 day · M 1–3 days · L > 3 days. "Why" explains the value to a user or operator.

## Now (next up)
| # | Item | Effort | Why | Notes |
|---|---|---|---|---|
| 1 | **First real deploy to AWS** | M | Turns the IaC into evidence: a live URL | Follow DEPLOYMENT → First deploy. Use the staging sizing to keep cost ~$115/mo, then destroy |
| 2 | Push to GitHub + enable SonarCloud | S | CI badges, a quality gate visible to reviewers | Set `SONAR_TOKEN`, `SONAR_ENABLED=true` |
| 3 | **Wildcard event types** (`order.*`) | S | The most-requested filtering feature in webhook products | Spec ready: [specs/001-wildcard-event-types.md](specs/001-wildcard-event-types.md) |
| 4 | Sweeper recovery integration test (TEST_PLAN G2) | S | The "no lost events" claim needs an automated proof | Make the sweep interval configurable via env |
| 5 | Measure integration coverage (G1) | S | Honest coverage numbers in Sonar | `NODE_V8_COVERAGE` + c8 merge |

## Next
| # | Item | Effort | Why |
|---|---|---|---|
| 6 | Queue-depth autoscaling for workers | M | CPU is a poor signal for I/O-bound workers. Publish queue gauges via CloudWatch EMF → step scaling |
| 7 | Endpoint secret rotation (overlap window, two signatures) | M | Customers rotate secrets without downtime. The header format already supports it |
| 8 | API key rotation (two active keys) | S | Revoke a leaked key without an outage |
| 9 | Per-endpoint concurrency/rate limit | M | Fairness: one slow receiver can't monopolize workers |
| 10 | Attempts retention + monthly partitioning | M | Bounded storage, stable query latency |
| 11 | Trace propagation API → worker (`traceparent` in job data) | S | One trace from ingestion to final delivery |
| 12 | Playwright E2E for the dashboard (G3) | S | Covers the BFF/SSE path |

## Later
| # | Item | Effort | Why |
|---|---|---|---|
| 13 | Multi-user dashboard auth (OIDC) with roles | L | Today the dashboard uses one tenant key on the server |
| 14 | Response schemas in OpenAPI + generated TS client SDK | M | Typed integrations for producers |
| 15 | Event type catalog with JSON Schema per type and payload validation | M | Producers can't send malformed events |
| 16 | Dead-letter view + bulk replay by filter/time range | M | Recover after a customer outage in one action |
| 17 | Transformations (filter/map payload per endpoint) | L | Svix/Hookdeck parity |
| 18 | WAF, verify-full TLS to RDS, KMS envelope encryption of secrets | M | Security hardening list in SECURITY.md |
| 19 | SQS as the trigger queue (behind `RetryScheduler`) | M | Removes Redis from the critical path at very high scale |

## Explicitly out of scope
- Exactly-once delivery (impossible over HTTP; at-least-once + receiver dedupe is the industry contract).
- Ordering guarantees across messages (documented as unordered, the same as Stripe/Svix).
