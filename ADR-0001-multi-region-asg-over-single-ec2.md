# ADR-0001: Multi-Region Auto Scaling Groups Over Single EC2 Instance

**Status:** Accepted
**Date:** 2026-06-04
**Author:** Wilton B. Harrison
**Project:** Enterprise Project 4 — Multi-Region High Availability Platform

---

## Context

Project 1 (Cloud Infrastructure & Development) provisions a single t3.micro EC2 instance in one AWS region. This is appropriate for a portfolio baseline but does not meet enterprise reliability requirements. The question is how to evolve this architecture to handle real-world enterprise loads with 99.9%+ availability guarantees.

Enterprise requirements for this project:
- SLA: 99.9% uptime (~8.7 hours/year downtime budget)
- Traffic: variable, with potential 10× spikes during campaigns/launches
- Data: must survive the loss of an entire AWS region
- Security: must meet WAF + encryption + monitoring enterprise minimums

Three architectural options were evaluated:

1. **Single EC2 per region, multi-region Route53 failover** — simple, predictable cost
2. **Auto Scaling Group per region behind ALB + CloudFront origin group** — complexity, but full HA
3. **AWS Elastic Beanstalk** — managed, less IaC control

---

## Decision

**Use Auto Scaling Groups (ASG) with Launch Templates in two regions (us-east-1 primary, us-west-2 DR) behind a CloudFront distribution with an origin group for CDN-level failover.**

Primary region: desired=3, min=2, max=20 instances across 3 AZs
DR region: desired=1, min=1, max=20 instances (warm standby)
CloudFront: primary origin + DR origin in a failover group (5xx triggers CDN reroute)
Route53 health checks: poll every 30s, fail after 3 checks → triggers DNS failover

---

## Rationale

### Why ASG over single EC2
- Statistically, a single EC2 instance fails approximately once per 18 months (hardware, AZ events, maintenance). An ASG automatically replaces failed instances within minutes.
- Traffic spikes that would crash a single server are absorbed by scale-out events. Target tracking policies handle this without manual intervention.
- Instance refresh enables zero-downtime OS/AMI updates — critical for patching without maintenance windows.

### Why two regions over one
- AWS regional outages, while rare, have occurred (us-east-1 has experienced partial and full outages). For enterprise SLAs, a single-region architecture has an inherent reliability ceiling.
- Active-passive is chosen over active-active: simplicity of data replication (RDS read replica rather than multi-master), lower cost (DR region at 1 instance vs. full capacity), and sufficient for most enterprise HA requirements.

### Why CloudFront origin groups over Route53 failover alone
- Route53 DNS failover has a minimum TTL/propagation delay of ~60-90 seconds and depends on DNS TTL caching at client resolvers (some resolvers ignore TTL, extending this to minutes).
- CloudFront origin groups fail over at the CDN edge in seconds — no DNS propagation involved. Users already connected continue without interruption.
- Both mechanisms are deployed in parallel: CloudFront for fast switchover, Route53 for complete regional isolation if needed.

### Why WAF at CloudFront (CLOUDFRONT scope) over ALB WAF
- CloudFront WAF blocks attacks before they reach the ALB or ASG instances, reducing cost and load.
- A single WAF ACL protects both the primary and DR origins automatically.
- CLOUDFRONT scope WAF rules must be provisioned in us-east-1 per AWS constraint — handled via provider alias.

---

## Positive Consequences

- Genuine 99.9%+ availability achievable with multi-AZ + multi-region architecture
- Auto-scaling removes manual capacity planning for variable traffic
- CloudFront CDN reduces latency globally and reduces origin load by serving cached content
- WAF + rate limiting provides protection without application code changes
- GuardDuty + Lambda automated response reduces MTTR (Mean Time To Respond) from hours to under 60 seconds

---

## Negative Consequences / Trade-offs

- **Cost:** Multi-region with 3 NAT Gateways + ALB + RDS Multi-AZ is significantly more expensive than Project 1's single EC2. Estimated ~$150-300/month vs. ~$15/month.
- **Complexity:** Multi-provider Terraform with `depends_on` across providers adds complexity to the state machine.
- **CloudFront deployment time:** Initial CloudFront distribution creation takes 15-25 minutes. Deployments are slower.
- **WAF `CLOUDFRONT` constraint:** WAF ACL must be in us-east-1 regardless of primary region — adds a third provider alias.

---

## Alternatives Considered

### Elastic Beanstalk
**Rejected:** Abstracts too much of the infrastructure — limits control over launch templates, health check configuration, and ASG scaling policies. Less demonstrable for infrastructure engineering roles.

### ECS Fargate in multiple regions
**Rejected:** Adds container orchestration complexity without clear benefit over ASG+EC2 for a stateful web application with a database tier. ECS is covered in depth by Project 2 / Enterprise Project 5.

### Single region with multi-AZ only
**Rejected:** Cannot survive an AWS regional event. NIST 800-53 contingency planning (CP-7) requires geographic separation for critical systems.

---

## Revisit Triggers

- Business requirement changes to active-active with global write consistency (would require Aurora Global or DynamoDB Global Tables)
- Cost analysis shows ASG is too expensive for workload patterns (consider Graviton instances or Spot instances with on-demand fallback)
- Compliance requirement adds data residency constraints to specific AWS regions
