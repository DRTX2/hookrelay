# Security

## Assets
Tenant API keys · endpoint signing secrets · event payloads (may contain PII) · the internal network/VPC (SSRF target) · availability of ingestion.

## Threat model (STRIDE, condensed)
| Threat | Scenario | Mitigation | Status |
|---|---|---|---|
| **S**poofing | A receiver gets a forged webhook | HMAC-SHA256 per Standard Webhooks; receivers verify with a per-endpoint secret | ✅ |
| Spoofing | Stolen API key | Keys are 192-bit random, stored as SHA-256 only, shown once. Revocation = delete the app | 🟡 rotation API pending |
| **T**ampering | Body modified in transit | Signature covers `id.timestamp.body`, TLS to receivers | ✅ |
| **R**epudiation | "We never got that event" | Immutable attempt history: status code, latency, response excerpt, timestamps | ✅ |
| **I**nformation disclosure | Tenant A reads tenant B's data | Every query is scoped by the `app_id` resolved from the key | ✅ (integration tested) |
| Information disclosure | Secrets in logs | No bodies/keys in logs, `no-console` lint, secrets via Secrets Manager | ✅ |
| **D**enial of service | One tenant floods ingestion | Per-tenant rate limit (Redis), 256 KB body cap | ✅ |
| Denial of service | Slow receivers exhaust workers | 15 s timeout, bounded concurrency, circuit breaker, separate worker process | ✅ |
| **E**levation | **SSRF**: endpoint URL points at metadata/VPC | Connect-time DNS check, private ranges blocked, no redirects ([ADR-0003](adr/0003-ssrf-guard-at-connect-time.md)) | ✅ |
| Elevation | Replay of a captured webhook | 5-minute timestamp tolerance + stable `webhook-id` for receiver dedupe | ✅ |

## OWASP API Security Top 10 (2023) mapping
| Risk | How it's addressed |
|---|---|
| API1 Broken object level authorization | All reads/writes filter by `app_id`. UUID path params validated (`ParseUUIDPipe`) |
| API2 Broken authentication | Hashed keys, constant-time admin token compare, no sessions to steal |
| API3 Broken object property level authorization | Responses select explicit columns. Secrets only returned by the endpoint detail route |
| API4 Unrestricted resource consumption | Rate limit per tenant, body size cap, pagination limit ≤100, receiver timeouts |
| API5 Broken function level authorization | Admin-only route behind `AdminGuard`. Everything else needs a tenant key |
| API6 Unrestricted access to sensitive flows | Ingestion rate-limited, resend only for `failed` deliveries |
| API7 **SSRF** | Core design concern, see above |
| API8 Security misconfiguration | `helmet`, CORS off by default, Trivy IaC scan in CI, private subnets, encrypted RDS/Redis/SNS |
| API9 Improper inventory management | One versioned surface (`/v1`), OpenAPI generated from code |
| API10 Unsafe consumption of APIs | Receiver responses truncated to 2 KB and stored as text, never parsed or followed |

## Supply chain & CI
- `pnpm install --frozen-lockfile`. Trivy filesystem scan (deps + secrets + IaC) and image scan fail the build on HIGH/CRITICAL fixable issues.
- CodeQL `security-extended` weekly and on every PR. gitleaks on full history.
- Images run as the non-root `node` user, built multi-stage with production dependencies only.
- GitHub → AWS through OIDC with branch/environment-pinned trust policies. No static credentials.

## Accepted risks (`.trivyignore`)
| ID | Why it's accepted |
|---|---|
| AVD-AWS-0053 public ALB | It's the product's entry point |
| AVD-AWS-0054 HTTP listener | Redirects to HTTPS when a certificate is configured. Plain HTTP only in demo environments |
| AVD-AWS-0104 unrestricted egress | Webhooks go to arbitrary URLs. Mitigated in the app by the SSRF guard |

## Pending hardening
1. Postgres TLS with **verify-full** (bundle the RDS CA). Today it's `sslmode=require` with libpq semantics (encrypted, not CA-pinned, inside the VPC).
2. API key rotation (two active keys per app) and endpoint secret rotation (send both signatures during the overlap, which the format already supports).
3. Encrypt endpoint secrets at the application layer (KMS envelope encryption) instead of relying on disk encryption alone.
4. AWS WAF on the ALB (managed rule sets + rate-based rule).
5. Payload PII policy: optional field-level redaction in stored attempts and configurable retention.
6. OWASP ZAP baseline scan in a nightly workflow.

## Reporting
Please report vulnerabilities privately to the maintainer (see the profile linked in the README) rather than opening a public issue.
