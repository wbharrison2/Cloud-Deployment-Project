# Project 5 Scenario: The Deployment That Broke Saturday Night

## Business Context

By early 2025, Artisan Gem Works had proven the two-location franchise model. The ECS
platform from Project 4 was stable: PostgreSQL Multi-AZ, Redis caching, CloudFront
delivery. Holiday 2024 handled 980 orders without incident.

But deploying was painful. Every update required a senior developer, a terminal, and
several hours of patience.

## The Manual Deploy Process (Before)

Every code change followed this sequence:

```
1. Developer SSHs into bastion host                    ~10 min
2. Pulls latest code, runs docker build locally        ~25 min
3. Pushes image to ECR manually                        ~8 min
4. Updates ECS task definition in AWS console          ~15 min
5. Triggers force-new-deployment, watches CloudWatch    ~45 min
6. Validates manually: curl endpoints, check logs      ~20 min
7. If something's wrong, manually identifies old       ~60–90 min
   task definition SHA and reverts

Total: ~3–6 hours per deploy, 100% manual
```

In six months, the team deployed 14 times. Average time: 5 hours 40 minutes.
Small fixes shipped days late. Feature work stalled waiting for deploy windows.

## The Incident: March 15, 2025 — Saturday Evening

### 2:00 PM — Deployment Approved

Mira approved the Spring Collection update:
- 4 new products added
- Pricing updated on 12 existing items
- New Seattle location hero image
- Admin dashboard layout tweak

The senior developer began the deploy. Estimated completion: ~6 hours.

### 7:52 PM — New Task Definition Applied

The updated ECS task definition was registered. Force-new-deployment initiated.
ECS began draining the old tasks and starting new ones.

### 8:23 PM — Health Check Anomaly

The new tasks were starting but CloudWatch showed repeated health check failures.
The ALB health check was: `GET /api/health → HTTP 200`. This check passed — the
Node.js process was running and `/api/health` returned 200 immediately on startup.

What the health check didn't catch: the new task had a misconfigured environment
variable. `DATABASE_URL` was spelled `DATABSE_URL` in the new task definition.
The app started fine, returned 200 on `/api/health`, but every API call that
touched the database failed with `Cannot read properties of undefined`.

### 8:47 PM — Both Old Tasks Terminated

ECS completed the deployment cycle. Old tasks were drained and terminated. The
two new tasks were "healthy" by ECS's definition. The site was live — but every
product load, every login, every checkout attempt returned 500.

Real traffic errors began at 8:47 PM. A customer called Mira's cell phone.

### 8:51 PM — Developer Alerted

Developer received the alert (Slack from Mira). Began diagnosing remotely.
CloudWatch logs showed `DATABSE_URL` — the typo was immediately obvious.

### 8:58 PM — Revert Attempted

To roll back, the developer needed to identify which previous task definition
revision was last healthy. ECS keeps revision history but the console shows
dozens of revisions with cryptic names. The developer had to cross-reference
CloudWatch timestamps against task definition registration times.

Correct revision identified: `agw-task:47`. Force-new-deployment triggered.

### 9:34 PM — Site Restored

Old task definition deployed, both tasks healthy, traffic flowing. Downtime
clock stopped: **47 minutes**.

It was a Saturday evening. Saturday is AGW's highest-traffic day.

### Financial Impact

| Metric | Value |
|--------|-------|
| Downtime | 47 minutes |
| Time of incident | 8:47–9:34 PM Saturday |
| Orders lost (estimated at Saturday peak rate) | ~34 |
| Average order value | $187 |
| Revenue impact | ~$6,360 |
| Developer time (detection + revert) | 2.5 hours |
| Mira's Saturday evening | Ruined |

### Mira's Reaction

On Sunday morning, Mira wrote:

> "A typo in a config field shut us down for 47 minutes on our busiest night.
> Why did the health check say everything was fine when nothing worked? Why did
> rolling back take 36 minutes? Why does a four-product update take six hours
> and still break? I need this fixed before summer."

## Root Cause Analysis

### RC-1: Inadequate Health Check

The ECS health check verified only that the HTTP server was listening. It did
not verify that the application could actually serve requests (connect to DB,
read from Redis). A process can start and return 200 on a static route while
being completely broken for real traffic.

**Fix**: Kubernetes readiness probe hits `/api/ready`, which executes a test
DB query and a Redis ping before returning 200. Pods that can't connect to
dependencies never enter the load balancer rotation.

### RC-2: No Automated Rollback

ECS has no built-in rollback. When a deployment completes (tasks reach
"running" state), ECS considers it successful regardless of application
behavior. Manual rollback required identifying the correct previous revision.

**Fix**: ArgoCD monitors pod health post-deployment. If pods fail readiness
probes, ArgoCD automatically reverts to the previous manifest revision.
`kubectl rollout undo` works in seconds.

### RC-3: Zero-Downtime Was Not Guaranteed

The ECS deployment terminated old tasks as new tasks reached "running" state,
not "healthy" state. During the window between old task termination and new
task failure detection, traffic was served by broken containers.

**Fix**: Kubernetes rolling update with `maxUnavailable: 0` and `maxSurge: 1`.
New pods must pass readiness probes before old pods are terminated. Traffic
never routes to unready pods.

### RC-4: No CI/CD Pipeline

All deployments were manual, error-prone, and dependent on a single developer.
Human error (typos in task definitions, wrong image tags) was an accepted risk.

**Fix**: GitHub Actions pipeline builds, tests, and pushes with zero manual
steps. Environment variables are stored in Kubernetes Secrets, not manually
entered in the AWS console.

## The Solution: EKS + GitHub Actions + ArgoCD

### New Deploy Flow

```
Developer pushes to main branch
         │
         ▼
GitHub Actions (automated, ~5 min)
├── npm ci && npm test
├── docker build --target production
├── docker push to ECR (tagged with git SHA)
└── Update k8s/deployment.yaml image tag, commit
         │
         ▼
ArgoCD detects manifest change (GitOps, ~30 sec)
├── kubectl apply rolling update
├── New pod starts, runs readiness probe
│   └── GET /api/ready → tests DB query + Redis PING
├── If probe fails → pod never gets traffic, rollout pauses
│   └── ArgoCD auto-reverts (previous image tag)
└── If probe passes → old pod gracefully terminated
         │
         ▼
Deploy complete (~8 min total)
```

### Result: Summer 2025

| Metric | Before (ECS Manual) | After (EKS+ArgoCD) |
|--------|--------------------|--------------------||
| Deploy time | 5h 40min avg | 8 minutes |
| Deploys per month | 2–3 | 12–15 |
| Downtime incidents | 1 (47 min) | 0 |
| Rollback time | 36 minutes | 45 seconds |
| Human steps per deploy | ~40 | 1 (git push) |
| Configuration typos | Possible | Impossible (Secrets managed in k8s) |

Artisan Gem Works deployed 37 times between April and September 2025.
Zero incidents. The Spring Collection launched on time. Mira got her
Saturday evenings back.
