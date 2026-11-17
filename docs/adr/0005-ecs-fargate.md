# ADR-0005: Run on AWS ECS Fargate (not Lambda, not EKS)

- Status: accepted

## Options
| Option | Pros | Cons for this system |
|---|---|---|
| Lambda + SQS | No servers, scales to zero | 15-min limit is fine, but SSE streams, long-lived BullMQ consumers and Redis pub/sub don't fit; cold starts on ingestion |
| EKS | Maximum control | A cluster to operate for 3 services; cost and expertise overhead |
| **ECS Fargate** | Long-running containers, per-service autoscaling, ALB integration, deployment circuit breaker with rollback | Pays for idle capacity |

## Decision
ECS Fargate behind an ALB, provisioned with Terraform. Images are immutable in ECR. Deploys go through GitHub Actions with OIDC roles.

## Consequences
- The same container runs locally (compose) and in AWS.
- Migration path: queue depth → step scaling for workers; SQS could replace BullMQ if Redis becomes the bottleneck (see ROADMAP).
