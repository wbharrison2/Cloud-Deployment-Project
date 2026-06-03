# Project 1 — Cloud Infrastructure & Development
**Author:** Wilton B. Harrison  
**Stack:** Terraform · AWS · Python · Boto3  
**Tier:** Cloud Engineer Portfolio Project

---

## Overview

This project provisions a **production-grade, 3-tier AWS VPC** from scratch using Terraform Infrastructure-as-Code (IaC). It establishes the foundational cloud architecture that all other projects build upon — including compute, storage, networking, security groups, and IAM.

A companion Python deployment script (`deploy.py`) automates packaging and pushing web application artifacts to EC2 via S3 + AWS SSM, requiring zero manual SSH access.

---

## Architecture

```
Internet
    │
    ▼
[Internet Gateway]
    │
    ▼
┌─────────────────────────────────────────────┐
│              VPC  10.0.0.0/16               │
│                                             │
│  ┌─────────────┐    ┌─────────────┐         │
│  │ Public Sub  │    │ Public Sub  │  ◄── Tier 1: Web / ALB
│  │ 10.0.1.0/24 │    │ 10.0.2.0/24 │         │
│  └──────┬──────┘    └──────┬──────┘         │
│         │ NAT GW           │                │
│  ┌──────▼──────┐    ┌──────▼──────┐         │
│  │ Private Sub │    │ Private Sub │  ◄── Tier 2: App Servers
│  │ 10.0.10.0   │    │ 10.0.11.0   │         │
│  └──────┬──────┘    └──────┬──────┘         │
│         │                  │                │
│  ┌──────▼──────┐    ┌──────▼──────┐         │
│  │  Data Sub   │    │  Data Sub   │  ◄── Tier 3: DB / Data
│  │ 10.0.20.0   │    │ 10.0.21.0   │         │
│  └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────┘
          │
          ▼
    [S3 Artifact Bucket] ── versioned, encrypted, private
```

---

## Components

| Resource | Description |
|---|---|
| `aws_vpc` | Primary VPC with DNS support enabled |
| `aws_subnet` (x6) | 3-tier subnets across 2 AZs (public/private/data) |
| `aws_internet_gateway` | Public egress for Tier 1 |
| `aws_nat_gateway` | Private egress for Tier 2 (no direct internet exposure) |
| `aws_route_table` (x2) | Separate routing for public/private tiers |
| `aws_security_group` (x3) | Tiered SGs: web → app → data (least-privilege) |
| `aws_instance` | EC2 t3.micro web server (Amazon Linux 2, encrypted EBS) |
| `aws_iam_role` | EC2 IAM role with SSM managed policy (no SSH keys needed) |
| `aws_s3_bucket` | Encrypted, versioned, fully private artifact bucket |

---

## Security Controls Applied

- **Encryption at rest:** EBS volumes (AES-256), S3 (SSE-AES256)
- **Public access blocked:** S3 bucket fully private
- **Least-privilege SGs:** Each tier only allows traffic from the tier above
- **No SSH ingress:** EC2 access via AWS SSM Session Manager only
- **IAM role scoped:** EC2 role limited to SSM + S3 bucket access
- **S3 versioning:** Full artifact history for rollback capability

---

## Prerequisites

| Tool | Version | Source |
|---|---|---|
| Terraform | >= 1.6 | https://developer.hashicorp.com/terraform/install |
| AWS CLI | >= 2.x | https://aws.amazon.com/cli/ |
| Python | >= 3.9 | https://python.org |
| boto3 | latest | `pip install boto3 click` |

---

## Quick Start

```bash
# 1. Clone / navigate to project directory
cd project1-cloud-infra

# 2. Configure AWS credentials
aws configure

# 3. Initialize Terraform
terraform init

# 4. Preview infrastructure changes
terraform plan -out=tfplan

# 5. Apply infrastructure
terraform apply tfplan

# 6. Deploy web app (after infrastructure is up)
python deploy.py \
  --bucket <output: s3_bucket_name> \
  --instance-id <output: web_instance_id> \
  --app-dir ./app

# 7. Verify
curl http://<output: web_instance_ip>
```

---

## Teardown

```bash
terraform destroy
```

> ⚠️ This destroys ALL resources including the S3 bucket. Ensure artifacts are backed up first.

---

## Key Learning Outcomes

- Terraform state management with remote S3 backend + DynamoDB locking
- 3-tier VPC network segmentation (defense in depth)
- Security group chaining to enforce least-privilege data flows
- IAM instance profiles and SSM-based access (replacing SSH)
- S3 encryption, versioning, and public access controls
- Automated CI/CD artifact pipeline with Python + Boto3

---

## Open-Source References

- [Terraform AWS Provider Docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [AWS VPC User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/)
- [Boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)
- [AWS SSM Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/execute-remote-commands.html)
