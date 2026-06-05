# Project 5 Summary

## Problem

The ECS Fargate platform (Project 4) required entirely manual deployments averaging
5 hours 40 minutes each. A misconfigured environment variable on March 15, 2025 caused
47 minutes of downtime because ECS health checks did not verify application behavior
and rollback required manually hunting through task definition revisions.

## Solution

Migrated to Kubernetes on EKS with GitHub Actions CI/CD and ArgoCD GitOps. Readiness
probes verify database and Redis connectivity before pods receive traffic. Rolling updates
with maxUnavailable=0 guarantee zero downtime during deployments. ArgoCD auto-reverts
failed deployments in under 60 seconds.

## Before vs. After

| Dimension | Project 4 (ECS Fargate) | Project 5 (EKS + ArgoCD) |
|-----------|------------------------|---------------------------|
| **Compute** | ECS Fargate, fixed 2 tasks | EKS, 2–10 pods (HPA) |
| **Deployment** | Manual 6-step script, ~6 hours | Git push → 8 minutes automated |
| **Rollback** | Manual task-def revision hunt, ~36 min | `kubectl rollout undo`, ~45 sec |
| **Health check** | TCP port 3000 open | `/api/ready` (DB query + Redis PING) |
| **Zero-downtime deploy** | Not guaranteed | Guaranteed (maxUnavailable=0) |
| **Scaling** | Fixed 2 tasks | Auto 2–10 pods (HPA, CPU 70%) |
| **Network isolation** | VPC security groups only | + Kubernetes NetworkPolicy |
| **Secrets management** | Manual entry in AWS console | Kubernetes Secrets |
| **CI/CD** | None | GitHub Actions + ArgoCD |
| **Rollout visibility** | CloudWatch logs | `kubectl rollout status` + ArgoCD UI |
| **Node maintenance safety** | No protection | PodDisruptionBudget (minAvailable=1) |
| **Deploys per month** | 2–3 (limited by manual effort) | 12–15 (automated) |
| **Downtime incidents** | 1 (47 min, March 2025) | 0 |

## Architecture Diagram

```
[Customers]
    │ HTTPS
    ▼
[CloudFront + WAF]
    │ HTTPS (origin: ALB)
    ▼
[Application Load Balancer]
    │ HTTP (internal)
    ▼
[NGINX Ingress Controller] ← cert-manager (TLS)
    │
    ▼
[agw-production namespace]
    ├── Pod 1: agw-app (Node.js)
    ├── Pod 2: agw-app (Node.js)     ← minimum 2, HPA scales to 10
    └── Pod N: agw-app (Node.js)
         │                  │
         ▼                  ▼
    [RDS PostgreSQL    [ElastiCache
     Multi-AZ]          Redis 7.2]

[argocd namespace] ── watches k8s/ directory ── auto-applies changes
```

## Key Metrics

| Metric | Value |
|--------|-------|
| Deploy time (avg) | 8 minutes |
| Time to rollback | < 60 seconds |
| Minimum pods available | 1 (PDB) |
| Max pods at peak | 10 (HPA) |
| Health check depth | DB query + Redis PING |
| Incidents since migration | 0 |
| Deploys April–September 2025 | 37 |
