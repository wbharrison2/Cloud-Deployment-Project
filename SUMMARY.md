# Enterprise Project 4 — Executive Summary
## Multi-Region High Availability Platform

**Author:** Wilton B. Harrison | **Stack:** Terraform · AWS · Python | **Based on:** Project 1

---

## What This Project Proves

This project demonstrates the ability to design and deploy an **enterprise-grade, always-on cloud platform** that can survive regional outages, handle massive traffic spikes, block web attacks, and automatically respond to security threats — all using infrastructure-as-code.

This is the architecture pattern used by companies that cannot afford downtime: financial services, healthcare systems, e-commerce platforms, and SaaS products with enterprise SLAs.

---

## Before vs. After

| | Project 1 (Baseline) | Enterprise Project 4 |
|---|---|---|
| **Availability** | Single region, single server | Two regions, auto-scaling server groups |
| **RTO** (Recovery Time Objective) | Manual: hours | Automated Route53 failover: ~90 seconds |
| **RPO** (Recovery Point Objective) | S3 only | S3 + RDS Multi-AZ + cross-region replica |
| **Throughput** | 1 server | 2–20 servers + CloudFront global CDN |
| **Threat response** | Manual | Automated: 60-second quarantine |
| **Compliance** | Basic | KMS CMK, IMDSv2, WAF, audit logs |

---

## Architecture Decision Highlights

1. **Active-passive multi-region** — DR region kept warm (1 instance) to reduce cost while enabling fast failover
2. **3 NAT Gateways in primary** — true per-AZ HA; if an AZ fails, remaining AZs retain outbound connectivity
3. **CloudFront origin group** — CDN-level failover is invisible to users; no DNS TTL wait
4. **GuardDuty + Lambda** — automated response is faster than any human SOC team
5. **KMS CMK** — meets enterprise compliance requirements for key custody

---

## Skills Demonstrated

- Multi-provider Terraform: dual-region provisioning from a single root module
- Auto Scaling Groups with launch templates and rolling instance refresh
- RDS Multi-AZ + cross-region read replicas
- S3 CRR (cross-region replication) with IAM role-based permissions
- CloudFront with WAF integration and HA origin groups
- Route53 health check–based DNS failover
- KMS CMK with custom key policies
- GuardDuty threat detection (malware, S3, K8s audit)
- EventBridge + Lambda automated incident response
- CloudWatch dashboards, alarms, and SNS notification pipelines

---

## Open-Source Tools Used

| Tool | License | Purpose |
|---|---|---|
| Terraform >= 1.6 | MPL-2.0 | Infrastructure as code |
| AWS Provider >= 5.0 | MPL-2.0 | AWS resource management |
| Hashicorp Archive Provider | MPL-2.0 | Lambda zip packaging |
| Python 3.12 (Lambda) | PSF | Automated threat response |

*All cloud services (AWS) are pay-per-use. Estimated cost: ~$150-300/month in production configuration.*
