# Project 5: Artisan Gem Works Franchise — Kubernetes Platform

**Artisan Gem Works** — Fine handcrafted jewelry, two locations.

| | |
|---|---|
| **Portland Flagship** | 2847 NW Thurman St, Portland, OR 97210 |
| **Seattle Location** | 412 Pine St, Seattle, WA 98101 |
| **Owner** | Mira Chen |
| **Phone** | (503) 555-0142 (Portland) |
| **Website** | https://artisangemworks.com |

## What Changed from Project 4

Project 4 ran on ECS Fargate with a manual six-step deploy script. A botched
deployment on March 15, 2025 caused 47 minutes of downtime on a Saturday evening.
This project migrates to Kubernetes on EKS with automated CI/CD via GitHub Actions
and ArgoCD.

**Before → After**
- Deploy time: ~6 hours manual → ~8 minutes automated
- Rollback: manual task-definition hunt → `kubectl rollout undo` (automatic)
- Downtime on deploy: possible → zero (rolling update, maxUnavailable=0)
- Scaling: fixed 2 ECS tasks → HPA 2–10 pods based on CPU
- Health checks: TCP port open → readiness probe checks DB + Redis

## Architecture

```
Internet
    │
CloudFront (CDN + WAF)
    │
ALB ← NGINX Ingress Controller
    │
EKS Cluster (us-west-2)
├── agw-production namespace
│   ├── Deployment: agw-app (2–10 replicas, HPA)
│   │   ├── livenessProbe:  GET /api/health
│   │   └── readinessProbe: GET /api/ready  (checks DB + Redis)
│   ├── Service: ClusterIP
│   ├── Ingress: artisangemworks.com (TLS via cert-manager)
│   └── PodDisruptionBudget: minAvailable=1
├── cert-manager namespace (TLS certificates)
├── ingress-nginx namespace (NGINX Ingress Controller)
└── argocd namespace (GitOps controller)

Data Layer
├── RDS PostgreSQL 15 Multi-AZ (db.t3.medium)
├── ElastiCache Redis 7.2 (cache.t3.micro, 2 nodes)
└── S3 (product images, Terraform state)
```

## EKS Node Groups

| Group | Instance | Min | Max | Purpose |
|-------|----------|-----|-----|---------|
| `app-nodes` | t3.medium | 2 | 4 | Application pods |
| `system-nodes` | t3.small | 1 | 2 | ArgoCD, cert-manager, metrics-server |

## Pod Scaling (HPA)

| Condition | Replicas |
|-----------|----------|
| Normal traffic | 2 |
| Moderate load (CPU > 50%) | 4–6 |
| Peak load (CPU > 70%) | up to 10 |

## Product Catalog

### Shared (both locations)
| Product | Price |
|---------|-------|
| Sterling Silver Pendant Necklace | $89 |
| Rose Gold Stud Earrings | $124 |
| Handcrafted Copper Bracelet | $67 |
| Moonstone Ring | $156 |
| Labradorite Drop Earrings | $98 |
| Turquoise Cuff Bracelet | $143 |
| Pearl Strand Necklace | $189 |
| Garnet Cluster Ring | $212 |
| Mixed Metal Earring Set | $78 |
| Amethyst Pendant | $134 |

### Portland Exclusive
| Product | Price |
|---------|-------|
| Oregon Sunstone Ring | $287 |
| Crater Lake Blue Topaz Necklace | $198 |
| Pacific Driftwood Copper Set | $156 |

### Seattle Exclusive
| Product | Price |
|---------|-------|
| Puget Sound Aquamarine Ring | $243 |
| Pike Place Market Pendant | $167 |
| Cascade Jade Earrings | $134 |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | None | Liveness probe |
| GET | /api/ready | None | Readiness probe (checks DB + Redis) |
| GET | /api/locations | None | Store locations |
| GET | /api/products | None | Products (location filter) |
| GET | /api/products/:slug | None | Product detail |
| POST | /api/auth/login | None | Login |
| POST | /api/auth/logout | Cookie | Logout |
| GET | /api/auth/me | Cookie | Current user |
| POST | /api/auth/2fa/setup | Cookie+Admin | Setup TOTP |
| POST | /api/auth/2fa/enable | Cookie+Admin | Enable TOTP |
| POST | /api/auth/2fa/disable | Cookie+Admin | Disable TOTP |
| GET | /api/orders | Cookie | User orders |
| POST | /api/orders | Cookie | Place order |
| GET | /api/admin/products | Cookie+Admin | All products |
| POST | /api/admin/products | Cookie+Admin | Create product |
| PUT | /api/admin/products/:id | Cookie+Admin | Update product |
| DELETE | /api/admin/products/:id | Cookie+Admin | Delete product |
| GET | /api/admin/orders | Cookie+Admin | All orders |
| PUT | /api/admin/orders/:id/status | Cookie+Admin | Update order status |
| POST | /api/admin/cache/clear | Cookie+Admin | Clear Redis + CloudFront cache |
| GET | /api/admin/audit-log | Cookie+Admin | Audit log (paginated) |

## Security Controls

- **httpOnly cookies** — JWT never accessible to JavaScript (`__Host-agw_token`)
- **Helmet.js** — X-Frame-Options, HSTS, Content-Security-Policy
- **Rate limiting** — 200 req/15min API, 5 req/15min auth + admin
- **TOTP 2FA** — RFC 6238 admin authentication with backup codes
- **Redis JWT blocklist** — session revocation on logout
- **WAF** — OWASP CRS + IP rate limit 2000/IP (CloudFront scope)
- **Kubernetes NetworkPolicy** — pods only communicate with required services
- **Kubernetes Secrets** — credentials never in ConfigMaps or env vars in plain YAML
- **TLS everywhere** — HTTPS enforced, Redis TLS (`rediss://`), RDS SSL mode=require

## CI/CD Pipeline

```
Git push to main
    │
GitHub Actions (.github/workflows/deploy.yml)
    ├── 1. npm ci && npm test
    ├── 2. docker build (multi-stage)
    ├── 3. docker push to ECR (tagged with git SHA)
    ├── 4. Update k8s/deployment.yaml image tag
    └── 5. git commit + push manifest change
         │
ArgoCD (watching repo, path: k8s/)
    ├── Detects manifest change (image tag)
    ├── Applies rolling update (maxSurge=1, maxUnavailable=0)
    ├── Waits for readiness probes on new pods
    ├── Shifts traffic when pods healthy
    └── Auto-rollback if pods never become ready
```

## Rollback

```bash
# Instant rollback to previous version
kubectl rollout undo deployment/agw-app -n agw-production

# Check rollout history
kubectl rollout history deployment/agw-app -n agw-production

# Roll back to specific revision
kubectl rollout undo deployment/agw-app -n agw-production --to-revision=3
```

## Local Development

```bash
cp .env.example .env
# Edit .env with your values
docker-compose up -d
# App:   http://localhost:3000
# Admin: http://localhost:3000/admin.html
```

## Kubernetes Deployment (First Time)

```bash
# Prerequisites: kubectl, helm, AWS CLI, terraform

# 1. Provision EKS cluster
cd terraform && terraform init && terraform apply

# 2. Configure kubectl
aws eks update-kubeconfig --region us-west-2 --name agw-eks-cluster

# 3. Install NGINX Ingress
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace

# 4. Install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm upgrade --install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace --set installCRDs=true

# 5. Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 6. Create application secrets
kubectl create secret generic agw-secrets -n agw-production \
  --from-literal=JWT_SECRET="$(openssl rand -base64 64)" \
  --from-literal=DATABASE_URL="postgres://agw:PASS@RDS_ENDPOINT:5432/agwdb?sslmode=require" \
  --from-literal=REDIS_URL="rediss://:PASS@ELASTICACHE_ENDPOINT:6379"

# 7. Apply manifests
kubectl apply -f k8s/

# 8. Register ArgoCD app (GitOps mode)
argocd app create agw-app \
  --repo https://github.com/YOUR_ORG/agw-app \
  --path k8s \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace agw-production \
  --sync-policy automated \
  --auto-prune \
  --self-heal
```

## Demo Credentials

See `PRIVATE-ADMIN-GUIDE.md` for all credentials.

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@artisangemworks.com | Admin!2024Secure |
| Customer | customer@demo.com | Customer!2024Demo |

**Stripe Test Cards**: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (decline)
