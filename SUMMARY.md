# Summary — Project 4: Franchise High-Availability Platform

## One-Line Summary

Migrated from a single-node SQLite stack to a PostgreSQL-backed, multi-AZ ECS platform capable of serving two franchise locations simultaneously without downtime.

## Before vs. After

| Dimension | Before (P3) | After (P4) |
|-----------|-------------|------------|
| Database | SQLite 3 (WAL) on EFS | PostgreSQL 15 (RDS Multi-AZ) |
| DB writes | Single-process only | Concurrent writes from any task |
| DB failover | Manual EFS restore | Automatic (< 60s) |
| Compute | 1 ECS task | 2 ECS tasks (one per AZ) |
| Cache | Redis sidecar (ephemeral) | ElastiCache (persistent, multi-AZ) |
| Locations | Portland only | Portland + Seattle |
| Connection pooling | None (SQLite) | pg.Pool max=10/task |
| Load test (500 VU) | Crash at ~300 VU | Zero errors |
| Christmas 2024 orders | N/A | 980 processed |
| RTO (DB failure) | Hours (manual) | < 60 seconds (automatic) |

## Key Decisions

### PostgreSQL over MySQL
PostgreSQL's `LISTEN/NOTIFY`, JSONB column support, and superior concurrency control made it the clear choice. AWS RDS PostgreSQL 15 also supports logical replication for future read-scaling if needed.

### ECS Fargate over EC2
Fargate eliminates instance management. Two Fargate tasks across two AZs provide HA without the overhead of managing an ASG. Fargate Spot on the secondary task reduces cost ~70%.

### ElastiCache over Self-Managed Redis
ElastiCache provides automatic Multi-AZ failover (< 30s), CloudWatch metrics out of the box, and no Redis version management. The cost delta (~$45/mo) is trivial against the Black Friday loss.

### Stateless JWT (no sticky sessions)
Because auth state lives in the signed cookie (validated against Redis blocklist), any ECS task can serve any request. This enables zero-configuration load balancing and smooth rolling deploys.

## Lessons Learned

1. **Validate your database architecture before scaling compute.** Auto-scaling SQLite is worse than not auto-scaling.
2. **Readiness probes are mandatory.** Traffic to a starting container causes cascading errors.
3. **Managed services pay for themselves quickly.** ElastiCache + RDS Multi-AZ cost ~$180/mo combined. The Black Friday outage cost $28,400 in a single night.
4. **Load test before peak season.** A 30-minute k6 test would have caught the SQLite concurrency issue.
