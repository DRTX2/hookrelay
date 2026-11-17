# ADR-0003: Enforce SSRF protection inside the connection's DNS lookup

- Status: accepted

## Context
Customers choose arbitrary URLs. Without protection, the platform can be used to reach `169.254.169.254` (cloud credentials), localhost admin ports or the VPC. Checking the URL's resolved IP *before* `fetch` leaves a DNS-rebinding window: the name can resolve to a public IP at check time and a private one at connect time.

## Decision
- On registration: static checks (http/https only, no credentials, no private IP literals).
- On every delivery: a custom undici `Agent` whose `connect.lookup` resolves the name and rejects private, loopback, link-local, CGNAT, multicast and IPv4-mapped IPv6 addresses **before the socket opens**.
- Redirects are never followed (`redirect: 'manual'`).
- `ALLOW_PRIVATE_TARGETS=true` exists for local development only.

## Consequences
- No check-then-use gap. Unit tests prove a hostname resolving to 127.0.0.1 is refused by the agent.
- Workers still need unrestricted egress at the network layer (customer URLs are arbitrary); the Trivy finding is accepted with this ADR as the justification.
