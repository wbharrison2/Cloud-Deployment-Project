# ADR-0001 — PostgreSQL 15 (RDS) over SQLite for Franchise Platform

**Date:** 2024-12-01
**Status:** Accepted
**Deciders:** Mira Chen (Owner), Engineering Lead

## Context

The Black Friday 2024 incident demonstrated that SQLite cannot safely serve multiple concurrent writers. The franchise now operates two physical locations and requires a database that supports:
- Concurrent writes from 2+ ECS tasks
- Automatic failover with < 60-second RTO
- Multi-location data isolation (store_id FK)
- ACID transactions for order placement
- Connection pooling

## Decision

Adopt **PostgreSQL 15 on AWS RDS Multi-AZ** as the primary database, with a read replica for product/category queries.

## Alternatives Considered

| Option | Rejected Because |
|--------|----------------|
| SQLite (keep) | Cannot handle concurrent writers across ECS tasks |
| MySQL 8 | PostgreSQL's MVCC, JSONB, and pg_notify are preferable; team familiarity |
| DynamoDB | Schema-less NoSQL ill-suited for relational order/product data; complex joins |
| PlanetScale | MySQL-based; no native PostgreSQL; adds vendor dependency |

## Consequences

- **Positive:** Concurrent writes, < 60s automatic failover, connection pooling, familiar SQL
- **Positive:** RDS handles patching, backups (7-day PITR), Multi-AZ promotion automatically
- **Negative:** Monthly cost ~$120 (db.t3.medium Multi-AZ) vs $0 for SQLite
- **Negative:** Local dev requires Docker PostgreSQL (acceptable — already in docker-compose)
- **Neutral:** Migration required converting SQLite schema to PostgreSQL DDL (one-time, < 4 hours)
