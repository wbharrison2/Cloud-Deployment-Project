# Enterprise Project 4 — Multi-Region High Availability Platform
**Author:** Wilton B. Harrison
**Stack:** Terraform · AWS Auto Scaling · RDS Multi-AZ · CloudFront · WAF · GuardDuty · Lambda
**Tier:** Enterprise Cloud Engineer Portfolio Project
**Source Project:** [Project 1 — Cloud Infrastructure & Development](https://github.com/wbharrison2/Cloud-Deployment-Project)

---

## Overview

This project builds a **production-grade, multi-region active-passive platform** for enterprise applications requiring high availability, disaster recovery, and global content delivery. It extends Project 1's foundational 3-tier VPC architecture from a single EC2 instance to a fully redundant, auto-scaling, globally distributed system.

When the primary region (us-east-1) fails, Route53 health checks automatically redirect traffic to the DR region (us-west-2). CloudFront handles the CDN failover transparently. The entire platform is protected by an AWS WAF with OWASP rules and real-time threat response via GuardDuty + Lambda.

---

## Architecture

```
                    Users Worldwide
                         │
              ┌──────────▼──────────┐
              │    CloudFront CDN   │ ── WAF (OWASP rules + rate limit)
              │    + WAF ACL        │
              └──────────┬──────────┘
                         │ Origin Group (primary → DR failover)
        ┌────────────────┼────────────────────┐
        │                │                    │
        ▼                                     ▼
┌──────────────────┐              ┌──────────────────┐
│  US-EAST-1       │              │  US-WEST-2       │
│  PRIMARY         │              │  DISASTER RECOVERY│
│                  │              │                  │
│  ┌────────────┐  │              │  ┌────────────┐  │
│  │    ALB     │  │              │  │    ALB     │  │
│  └─────┬──────┘  │              │  └─────┬──────┘  │
│        │         │              │        │         │
│  ┌─────▼──────┐  │              │  ┌─────▼──────┐  │
│  │ ASG: 2-20  │  │              │  │ ASG: 1-20  │  │
│  │ instances  │  │              │  │ (warm sby) │  │
│  │ 3 AZs      │  │              │  │ 2 AZs      │  │
│  └─────┬──────┘  │              │  └────────────┘  │
│        │         │              │                  │
│  ┌─────▼──────┐  │              │  ┌────────────┐  │
│  │ RDS Multi- │  │◄─────────────│  │ RDS Read   │  │
│  │ AZ Primary │  │  Replication │  │ Replica    │  │
│  │ PostgreSQL │  │              │  │            │  │
│  └────────────┘  │              │  └────────────┘  │
└──────────────────┘              └──────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│          Route53 Health Checks (DNS Failover)       │
│  Primary ALB healthy → route to primary             │
│  Primary ALB fails  → switch to DR within ~90s      │
└─────────────────────────────────────────────────────┘
```

---

## Enterprise Upgrades Over Project 1

| Capability | Project 1 (Baseline) | Enterprise Project 4 |
|---|---|---|
| **Compute** | Single EC2 t3.micro | Auto Scaling Group: 2–20 × t3.small |
| **Regions** | Single (us-east-1) | Multi-region active-passive (us-east-1 + us-west-2) |
| **Tier count** | 3 tiers, 2 AZs | 3 tiers, 3 AZs primary + 2 AZs DR |
| **Database** | None | RDS PostgreSQL Multi-AZ + cross-region read replica |
| **CDN** | None | CloudFront global distribution |
| **WAF** | None | OWASP + SQLi + rate limiting (2000 req/s/IP) |
| **Scaling** | Manual | CPU + ALB request-rate target tracking |
| **Failover** | Manual | Automated Route53 DNS failover (~90s RTO) |
| **Storage** | S3 single-region | S3 cross-region replication (STANDARD_IA) |
| **Encryption** | AES-256 | KMS CMK with auto-rotation (EBS + RDS + S3 + SNS) |
| **EBS** | gp3 encrypted | gp3 KMS-encrypted, IMDSv2 required |
| **Monitoring (Passive)** | None | CloudWatch dashboards, alarms, SNS email |
| **Monitoring (Active)** | None | GuardDuty + Lambda auto-quarantine |
| **OS access** | SSM (no SSH) | SSM + CloudWatch Agent (no SSH) |

---

## Security Hardening Applied

### Inherited from Project 1
- **No SSH ingress** — EC2 accessed via AWS SSM Session Manager only
- **Tiered security groups** — each tier only accepts traffic from the tier above
- **IAM instance profiles** — EC2 role scoped to SSM + CloudWatch
- **S3 private** — public access fully blocked
- **EBS encrypted** — AES-256 at rest

### Enterprise Additions
- **KMS CMK with annual auto-rotation** — customer-managed key for EBS, RDS, S3, SNS, CloudWatch Logs
- **IMDSv2 required** — blocks SSRF-based credential theft from instance metadata
- **WAF OWASP rules** — blocks SQLi, XSS, known bad inputs, and rate-limits to 2000 req/s per IP
- **RDS deletion protection + backups** — 7-day backup window, Multi-AZ for zero-downtime failover
- **ALB invalid header drop** — prevents HTTP desync attacks
- **CloudFront TLS enforcement** — HTTP redirected to HTTPS, TLSv1.2 minimum
- **GuardDuty malware scanning** — EBS volumes scanned on HIGH/CRITICAL findings
- **Lambda auto-quarantine** — HIGH severity GuardDuty findings stop + tag compromised instances within 60s

### Passive Monitoring (Observability)
| Signal | Alarm | Threshold |
|---|---|---|
| ASG CPU | `wbh-ha-platform-asg-cpu-high` | > 80% for 2 min |
| ALB unhealthy targets | `wbh-ha-platform-unhealthy-targets` | Count > 0 |
| ALB 5xx errors | `wbh-ha-platform-alb-5xx-errors` | > 50/min × 2 min |
| RDS CPU | `wbh-ha-platform-rds-cpu-high` | > 75% for 3 min |
| RDS storage | `wbh-ha-platform-rds-storage-low` | < 5 GB |
| WAF blocks | CloudWatch WAF dashboard | Any |

### Active Monitoring (Automated Response)
| Trigger | Severity | Automated Action |
|---|---|---|
| GuardDuty finding | ≥ HIGH (7.0) | EC2 stopped + tagged QUARANTINED |
| GuardDuty finding | ≥ HIGH (7.0) | SNS alert sent within 60s |
| EventBridge | Any GuardDuty ≥ 7 | Lambda invoked automatically |

---

## Components

| Resource | Description |
|---|---|
| `aws_vpc` (×2) | Primary (3-AZ) + DR (2-AZ) VPCs |
| `aws_nat_gateway` (×4) | 3 per-AZ NAT GWs in primary, 1 in DR |
| `aws_lb` (×2) | ALB in primary + DR, invalid headers dropped |
| `aws_autoscaling_group` (×2) | Primary (desired 3, max 20) + DR warm standby |
| `aws_launch_template` (×2) | IMDSv2, KMS-encrypted EBS, CW agent |
| `aws_autoscaling_policy` (×2) | CPU target tracking + ALB request rate tracking |
| `aws_db_instance` (primary) | RDS PostgreSQL 15, Multi-AZ, Enhanced Monitoring |
| `aws_db_instance` (replica) | Cross-region read replica in us-west-2 |
| `aws_s3_bucket_replication_configuration` | CRR: primary artifacts → DR (STANDARD_IA) |
| `aws_wafv2_web_acl` | OWASP + SQLi + bad inputs + rate limit |
| `aws_cloudfront_distribution` | Global CDN with WAF, HA origin group |
| `aws_route53_health_check` (×2) | Health polling every 30s, 3-fail threshold |
| `aws_kms_key` | CMK for all primary-region encryption |
| `aws_guardduty_detector` (×2) | Threat detection in both regions |
| `aws_lambda_function` | Automated threat response (Python 3.12) |
| `aws_cloudwatch_event_rule` | EventBridge GuardDuty → Lambda bridge |
| `aws_sns_topic` | KMS-encrypted alerts with email subscription |
| `aws_cloudwatch_dashboard` | 5-widget operations dashboard |
| `aws_cloudwatch_metric_alarm` (×5) | CPU, unhealthy hosts, 5xx, RDS CPU, RDS storage |

---

## Prerequisites

| Tool | Version | Source |
|---|---|---|
| Terraform | >= 1.6 | https://developer.hashicorp.com/terraform/install |
| AWS CLI | >= 2.x | https://aws.amazon.com/cli/ |
| jq | any | `yum install jq` / `brew install jq` |

---

## Quick Start

```bash
# 1. Navigate to project directory
cd enterprise-project-4-ha-platform

# 2. Initialize Terraform (downloads providers for both regions)
terraform init

# 3. Preview infrastructure (review multi-region resource plan)
terraform plan -out=tfplan

# 4. Deploy
terraform apply tfplan

# 5. Run the deployment validation script
chmod +x deploy.sh
./deploy.sh --region us-east-1 --account-id <YOUR_AWS_ACCOUNT_ID>

# 6. Verify CloudFront endpoint (may take up to 20 min to fully propagate)
terraform output app_url

# 7. Open the CloudWatch dashboard
terraform output cw_dashboard
```

---

## CI/CD Integration (GitHub Actions)

```yaml
name: Deploy Enterprise HA Platform
on:
  push:
    branches: [main]
    paths: ['enterprise-project-4-ha-platform/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.6
      - run: |
          cd enterprise-project-4-ha-platform
          terraform init
          terraform plan -out=tfplan
          terraform apply tfplan
```

---

## Key Learning Outcomes

- Multi-provider Terraform: provisioning resources across two AWS regions in one root module
- Auto Scaling Groups with launch templates (IMDSv2, rolling instance refresh)
- RDS Multi-AZ with cross-region read replicas and enhanced monitoring
- S3 cross-region replication with IAM role-based permissions
- CloudFront origin groups for automatic CDN failover
- WAF WebACL with OWASP managed rules + custom rate limiting
- Route53 health check–based DNS failover (active-passive DR pattern)
- GuardDuty threat detection with EventBridge + Lambda automated remediation
- CloudWatch dashboards, metric alarms, and SNS notification pipelines
- KMS CMK lifecycle management: rotation, aliases, key policies

---

## Open-Source References

- [Terraform AWS Provider Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [AWS Auto Scaling User Guide](https://docs.aws.amazon.com/autoscaling/ec2/userguide/)
- [CloudFront Origin Groups](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/high_availability_origin_failover.html)
- [GuardDuty Developer Guide](https://docs.aws.amazon.com/guardduty/latest/ug/)
- [WAFv2 Managed Rule Groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups.html)
- [RDS Multi-AZ Deployments](https://aws.amazon.com/rds/features/multi-az/)
- [NIST 800-53 Availability Controls](https://csrc.nist.gov/projects/cprt/catalog)
