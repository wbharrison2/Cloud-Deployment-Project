# Scenario — Project 4: The Black Friday Crash

## Background

Artisan Gem Works had been operating its Portland boutique on the Project 3 platform since February 2024. The secure local stack (SQLite + Redis + TOTP 2FA) had been rock-solid for single-location retail — processing roughly 40 daily online orders without incident.

In September 2024, Mira Chen signed a lease for a second location at 4521 Ballard Ave NW in Seattle's Ballard neighborhood. The platform was patched to support a location dropdown and a second product set. SQLite continued to serve both locations from the same ECS task — a decision that would prove catastrophic.

---

## The Incident — November 29, 2024 (Black Friday)

### Timeline

| Time (PST) | Event |
|------------|-------|
| 12:00 AM | Black Friday sale goes live — 40% off sitewide |
| 12:04 AM | Traffic reaches 12× normal baseline |
| 12:17 AM | First SQLite `SQLITE_BUSY` errors in logs |
| 12:31 AM | ECS task restarts; SQLite WAL file partially corrupted |
| 12:35 AM | Second ECS task (auto-scaled) starts — both tasks fighting over EFS-mounted SQLite |
| 12:41 AM | Cascade failure: both tasks crash-looping |
| 01:02 AM | Mira and Priya receive PagerDuty alerts |
| 02:15 AM | Decision made to roll back to maintenance mode |
| 02:30 AM | Maintenance page live |
| 14:30 PM | Engineers restore service after 14-hour manual recovery |

### Root Cause

SQLite is a single-writer database. When the auto-scaler added a second ECS task, both containers mounted the same EFS volume and attempted concurrent writes. SQLite's write-ahead log could not coordinate across separate processes on separate containers. The result was WAL corruption.

### Impact

| Metric | Value |
|--------|-------|
| Downtime | 14 hours 1 minute |
| Lost orders (estimated) | 284 |
| Lost revenue (estimated) | **$28,400** |
| Email bounce-backs | 1,247 |
| Negative reviews posted | 23 |
| Social media complaints | 89 |
| Mira's sleep (hrs) | 2 |

> *"I watched our busiest day turn into our worst."* — Mira Chen, Owner

---

## The Investigation

Post-mortem analysis identified three compounding failures:

1. **Database architecture**: SQLite cannot handle multi-writer workloads. Every e-commerce platform of this size needs a client-server database with connection pooling.
2. **No readiness probe**: ECS tasks were registered with the ALB before the app was ready, splitting traffic to crashed instances.
3. **Single-point EFS**: Both tasks sharing one SQLite file was equivalent to two people trying to write the same Word document simultaneously over a slow network share.

---

## The Solution

### Phase 1 — Emergency (Week 1)
- Migrate SQLite → PostgreSQL 15 on RDS (us-west-2a, Multi-AZ standby in us-west-2b)
- Set ECS `desired_count = 2` (one per AZ) with `/health` readiness check
- Migrate Redis from sidecar to ElastiCache (managed, multi-AZ)

### Phase 2 — Stabilization (Weeks 2–3)
- Add location-aware product routing (`store_id` FK in products + orders)
- Implement connection pooling via `pg-pool` (max 10 per task, 20 total)
- Add RDS read replica in us-west-2b for product/category reads
- Set up CloudWatch alarms: DB connections, ECS task health, p99 latency

### Phase 3 — Validation (Week 4)
- Load test with k6: 500 virtual users, 10-minute ramp — zero errors
- Chaos test: manually terminate primary RDS — automatic failover in 47 seconds
- Christmas 2024: 980 orders, zero downtime

---

## Results (Christmas 2024 vs. Black Friday 2023)

| Metric | Black Friday 2023 | Christmas 2024 |
|--------|--------------------|----------------|
| Peak concurrent users | ~320 | ~890 |
| Uptime | 41.7% (14h outage) | 100% |
| Orders processed | ~0 (outage) | 980 |
| Revenue | $0 (lost $28,400) | ~$98,000 |
| DB failover tested | No | 47s automatic |
| Error rate | 100% | 0.03% |

> *"We went from disaster to our best sales month ever. The new platform paid for itself in one day."* — Mira Chen
