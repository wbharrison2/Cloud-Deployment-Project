# ADR-0002 — ECS desired_count=2 with ALB Health Checks for HA

**Date:** 2024-12-01
**Status:** Accepted
**Deciders:** Mira Chen (Owner), Engineering Lead

## Context

During Black Friday, the auto-scaler added a second ECS task that immediately received traffic before the app was ready, splitting requests between a running instance and a starting one. The result was 50% error rate even before the DB crashed.

## Decision

Set `desired_count = 2` permanently (not auto-scaling to zero). Require `/health` to return HTTP 200 before the ALB routes traffic to a task. One task per Availability Zone.

## Rationale

- **Always-on second task:** Eliminates cold-start traffic splits during scale-out. Second task absorbs traffic instantly during primary task replacement.
- **ALB health check:** `healthy_threshold=2, interval=15s` — task must pass two consecutive health checks before receiving traffic (~30s warm-up). Prevents premature routing.
- **One task per AZ:** If an AZ goes down, the other task continues serving requests. ALB automatically routes around unhealthy targets.
- **Fargate Spot for task 2:** Reduces compute cost ~70%. If Spot capacity is reclaimed, ECS launches a standard Fargate replacement. The primary task (standard Fargate) is unaffected.

## Consequences

- **Positive:** Zero downtime during deployments (rolling update: task 1 new, task 2 old, then swap)
- **Positive:** AZ failure tolerance
- **Negative:** 2× compute cost vs. desired_count=1 (~$35/mo additional)
- **Negative:** Connection pool must be sized carefully: 2 tasks × 10 connections = 20 total (within RDS db.t3.medium limit of 100)
