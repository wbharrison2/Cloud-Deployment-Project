# Changes: Project 4 → Project 5

This document describes what changed from the ECS Fargate platform (Project 4)
to the Kubernetes on EKS platform (Project 5).

## Change 1: ECS Fargate → Amazon EKS

**What changed**: Replaced ECS Fargate service with an EKS cluster running
managed node groups (t3.medium, 2–4 nodes).

**Why**: ECS has no native rolling-update health verification. Kubernetes
Deployments with readiness probes guarantee that pods serving traffic are
fully functional before old pods are removed.

**Files affected**: `terraform/main.tf`, `k8s/deployment.yaml`, `k8s/service.yaml`

## Change 2: Manual deploy.sh → GitHub Actions + ArgoCD

**What changed**: Replaced the 6-step manual deploy script with a fully
automated CI/CD pipeline. GitHub Actions builds and pushes the image; ArgoCD
applies the change using GitOps (the k8s/ directory is the source of truth).

**Why**: Every manual deploy was 5+ hours and error-prone. The March 15 incident
was caused by a typo entered manually in the AWS console.

**Files added**: `.github/workflows/deploy.yml`, `argocd/application.yaml`

## Change 3: TCP Health Check → Readiness Probe on /api/ready

**What changed**: Added a `/api/ready` endpoint that executes a test PostgreSQL
query (`SELECT 1`) and a Redis `PING` before returning 200. Kubernetes readiness
probe calls this endpoint; pods that fail are removed from the load balancer.

**Why**: The ECS health check verified only that port 3000 was open. A running
process that cannot reach the database passed the health check and received
production traffic while returning 500 errors to real users.

**Files affected**: `app/server.js`, `k8s/deployment.yaml`

## Change 4: Fixed 2 ECS Tasks → HPA 2–10 Pods

**What changed**: Replaced fixed `desired_count=2` in ECS with a Kubernetes
HorizontalPodAutoscaler targeting 70% CPU utilization, scaling between 2 and
10 replicas.

**Why**: Franchise traffic is uneven. Weekend peak traffic is 4–5x weekday
baseline. Fixed capacity either over-provisions (wasting cost) or under-provisions
(causing slowdowns).

**Files added**: `k8s/hpa.yaml`

## Change 5: No Disruption Budget → PodDisruptionBudget

**What changed**: Added a PodDisruptionBudget requiring at least 1 pod to be
available at all times, even during voluntary disruptions (node maintenance,
cluster upgrades).

**Why**: Without a PDB, Kubernetes can drain all pods from a node simultaneously
during maintenance, causing a brief outage. With minAvailable=1, at least one
pod always serves traffic.

**Files added**: `k8s/pdb.yaml`

## Change 6: No Network Isolation → Kubernetes NetworkPolicy

**What changed**: Added Kubernetes NetworkPolicy rules restricting pod-to-pod
communication. App pods can only receive traffic from the ingress controller
and can only initiate connections to RDS and ElastiCache (external services).

**Why**: Project 4 used VPC security groups but had no application-layer network
isolation within the cluster. NetworkPolicy enforces least-privilege at the pod level.

**Files added**: `k8s/network-policy.yaml`

## Change 7: ECS Task Secrets → Kubernetes Secrets

**What changed**: Credentials (DATABASE_URL, REDIS_URL, JWT_SECRET, Stripe key)
are stored in Kubernetes Secrets and mounted as environment variables at runtime.
No credentials appear in task definitions, Dockerfiles, or CI pipelines.

**Why**: In Project 4, secrets were entered manually in the ECS task definition
via the AWS console — the same process that caused the DATABASE_URL typo incident.
Kubernetes Secrets enforce separation of credentials from deployment configuration.

**Files added**: `k8s/secret.yaml` (template — real values applied via kubectl,
never committed to the repository)

## Change 8: No Ingress → NGINX Ingress Controller

**What changed**: Replaced direct ALB-to-ECS routing with NGINX Ingress Controller
managing an ALB. Ingress rules handle TLS termination (via cert-manager) and
path-based routing.

**Why**: Kubernetes Ingress provides a unified, declarative way to manage routing
rules. NGINX Ingress supports advanced rate limiting, connection limiting, and
request filtering at the ingress layer.

**Files added**: `k8s/ingress.yaml`
