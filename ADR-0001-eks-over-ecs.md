# ADR-0001: Amazon EKS Over ECS Fargate

**Date**: 2025-03-20  
**Status**: Accepted  
**Deciders**: Mira Chen (owner), senior developer

## Context

Following the March 15 incident (47-minute outage from a misconfigured ECS task
definition), the team evaluated compute platforms that would provide:

1. Guaranteed zero-downtime rolling deployments
2. Application-level health verification before traffic routing
3. Automated rollback on deployment failure
4. Horizontal autoscaling

## Decision

Migrate to Amazon EKS (Elastic Kubernetes Service) with managed node groups.

## Options Considered

### Option A: Fix ECS (Application Load Balancer health checks + CodeDeploy blue/green)

**Pros**: No infrastructure change, team already familiar with ECS

**Cons**: CodeDeploy blue/green requires full duplicate environment (double cost during
deployment), health check is still HTTP-only (can't run custom logic), rollback is
still a manual CodeDeploy action, no HPA equivalent

**Rejected**: Addresses symptoms, not root causes. Blue/green doubles cost during deploy.

### Option B: Amazon EKS

**Pros**: Readiness probes with arbitrary HTTP logic, rolling update guarantees zero
downtime with maxUnavailable=0, HorizontalPodAutoscaler built-in, PodDisruptionBudget
for maintenance safety, large ecosystem (ArgoCD, Helm, cert-manager), strong industry
adoption, Kubernetes skills transfer across cloud providers

**Cons**: More complex than ECS, requires learning kubectl and K8s concepts, managed
node groups add EC2 cost vs. Fargate's serverless model

**Accepted**.

### Option C: AWS App Runner

**Pros**: Fully managed, even simpler than Fargate, automatic HTTPS

**Cons**: No readiness probe customization, no NetworkPolicy, no HPA control, limited
to single region, no ArgoCD integration, insufficient control for production franchise
needs

**Rejected**: Too little control over deployment behavior.

## Consequences

**Positive**:
- Rolling deployments with readiness probe verification eliminate ECS-style false-health
- HPA handles weekend traffic spikes automatically
- PDB protects against full outage during node maintenance
- kubectl rollout undo provides instant, deterministic rollback
- ArgoCD provides audit trail of every deployment (who changed what, when)

**Negative**:
- Node groups introduce EC2 instance management (mitigated with managed node groups)
- Kubernetes learning curve for future developers
- Slightly higher baseline cost than Fargate for low traffic periods

## Cost Comparison

| Item | ECS Fargate | EKS Managed Nodes |
|------|-------------|-------------------|
| Control plane | $0 | $0.10/hr (~$73/mo) |
| Compute (2 tasks/pods) | ~$65/mo | ~$58/mo (t3.medium) |
| Compute (peak 10 pods) | N/A | ~$175/mo |
| Incidents avoided | N/A | $6,360+ saved |

EKS control plane adds $73/mo. HPA reduces over-provisioning. One prevented
incident pays for 8+ months of EKS overhead.
