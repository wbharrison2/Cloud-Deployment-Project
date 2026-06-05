# Changes — Project 4: Franchise High-Availability Platform

## Change 1 — Database: SQLite → PostgreSQL 15

**Driver:** SQLite cannot handle concurrent writes from multiple ECS tasks.

**What changed:**
- Replaced `better-sqlite3` with `pg` (node-postgres) + connection pool (max=10)
- New schema: `stores`, `products`, `users`, `orders`, `order_items`, `audit_log` tables
- RDS Multi-AZ: primary in us-west-2a, automatic standby in us-west-2b
- RDS read replica in us-west-2b for read-heavy product/category queries
- All DB credentials in AWS Secrets Manager (not env vars)

## Change 2 — Compute: 1 ECS Task → 2 Tasks (Multi-AZ)

**Driver:** Single task = single point of failure; Black Friday auto-scale made things worse.

**What changed:**
- `desired_count = 2` — one task per AZ at all times
- ECS capacity provider: FARGATE_SPOT for task 2 (cost savings), FARGATE for task 1
- ALB `/health` readiness check before traffic routing
- Session stickiness disabled — JWT cookies are stateless

## Change 3 — Cache: Redis Sidecar → ElastiCache

**Driver:** Sidecar Redis is lost on task restart; no persistence across deployments.

**What changed:**
- ElastiCache Redis 7.2 (cluster mode disabled, one primary + one replica)
- Multi-AZ automatic failover enabled
- Cache TTL: products 5 min, categories 1 hr, location list 24 hr

## Change 4 — Multi-Location Product & Order Routing

**Driver:** Franchise expansion requires per-location inventory and order attribution.

**What changed:**
- New `stores` table: `{ id, slug, name, address, phone, hours, manager }`
- `products.store_id` FK: NULL = shared across all locations, value = location-exclusive
- `orders.store_id` FK: every order attributed to originating location
- New endpoint: `GET /api/locations` — returns all active stores with details
- `GET /api/products?location=pdx|sea` — returns shared + location-exclusive products
- Location preference stored in localStorage (`agw_location`); defaults to Portland

## Change 5 — Connection Pooling

**Driver:** Each ECS task previously opened unbounded DB connections.

**What changed:**
- `pg.Pool` with `max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000`
- RDS parameter group: `max_connections = 100` (supports 10 tasks × 10 = 100 max)
- Graceful pool drain on `SIGTERM` before ECS task stops

## Change 6 — Infrastructure: RDS + ElastiCache + Multi-AZ ECS

**Driver:** Managed services reduce operational toil and provide built-in HA.

**What changed:**
- `aws_db_instance.agw` — PostgreSQL 15, db.t3.medium, Multi-AZ, encrypted
- `aws_db_instance.read_replica` — db.t3.medium read replica
- `aws_elasticache_replication_group.agw` — Redis 7.2, automatic failover
- ECS desired_count=2, deployment_minimum_healthy_percent=50
- CloudWatch alarms: RDS connections, CPU, free storage; ECS task count

## Change 7 — Admin: Location Management Dashboard

**Driver:** Franchise owner needs to view orders and products per location.

**What changed:**
- Admin panel gains Location filter on Orders and Products tabs
- `GET /api/admin/orders?location=pdx|sea` — filter by store
- New admin overview card shows per-location revenue totals
