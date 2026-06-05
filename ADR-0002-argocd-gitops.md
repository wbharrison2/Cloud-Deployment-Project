# ADR-0002: ArgoCD for GitOps Continuous Delivery

**Date**: 2025-03-20  
**Status**: Accepted  
**Deciders**: Mira Chen (owner), senior developer

## Context

With EKS as the compute platform, a continuous delivery mechanism is needed.
Requirements:

1. Zero manual steps to deploy after code review
2. Audit trail: who deployed what, when
3. Automatic rollback on deployment failure
4. Drift detection: alert if live cluster diverges from Git
5. Works with existing GitHub repository

## Decision

Use GitHub Actions for CI (build + test + image push) and ArgoCD for CD
(GitOps: watch k8s/ directory, apply changes automatically).

## Options Considered

### Option A: GitHub Actions only (kubectl apply in pipeline)

**Pros**: Single tool, no additional cluster component

**Cons**: Pipeline needs cluster credentials (kubeconfig in GitHub Secrets), no
drift detection, no auto-rollback on application failure (only on pipeline failure),
no UI for deployment status, pull model is safer than push model for credentials

**Rejected**: Credentials exposure risk; no drift detection.

### Option B: AWS CodePipeline + CodeDeploy

**Pros**: Native AWS, no additional tools

**Cons**: Poorly suited to Kubernetes workflows, blue/green requires duplicate
environment cost, complex configuration, limited GitOps semantics

**Rejected**: ECS-centric, not well-suited to Kubernetes.

### Option C: GitHub Actions (CI) + ArgoCD (CD) — GitOps

**Pros**: ArgoCD runs inside the cluster (pull model — no external kubeconfig
exposed), Git is the single source of truth, auto-rollback on readiness failure,
drift detection alerts when live state diverges from Git, ArgoCD UI shows deployment
history with diffs, ApplicationSet for multi-environment (staging/production)

**Cons**: ArgoCD adds a cluster component (runs in `argocd` namespace), team must
learn ArgoCD concepts

**Accepted**.

## How It Works

```
Code change merged to main
         │
         ▼
GitHub Actions
├── npm ci && npm test
├── docker build + push to ECR (image tag = git SHA)
└── sed -i update k8s/deployment.yaml image tag
    git commit && git push
         │
         ▼
ArgoCD (running in cluster, polls repo every 3 min or webhook)
├── Detects image tag change in k8s/deployment.yaml
├── kubectl apply (rolling update)
├── Monitors pod readiness probes
├── If all pods healthy → marks sync successful
└── If pods fail readiness → marks sync failed, reverts to previous revision
```

## Rollback Behavior

ArgoCD rollback is declarative: it applies the previous Git revision's manifests.
This means rolling back is identical to any other deployment — readiness probes
run, old version is verified healthy before old-old version terminates.

```bash
# Via ArgoCD CLI
argocd app rollback agw-app

# Via kubectl (equivalent)
kubectl rollout undo deployment/agw-app -n agw-production
```

## Consequences

**Positive**:
- No kubeconfig in GitHub Secrets (pull model)
- Every deployment is a Git commit (full audit trail)
- Drift detection prevents configuration from drifting from Git
- Auto-rollback on readiness failure handles the March 15 scenario automatically
- ArgoCD UI provides real-time deployment progress visible to non-developers

**Negative**:
- CI pipeline must commit back to the repository (image tag update)
- Requires ArgoCD to be running and healthy for deployments to proceed
- Additional namespace and RBAC rules to manage
