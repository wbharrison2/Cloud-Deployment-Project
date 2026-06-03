# SUMMARY — Project 1: Cloud Infrastructure & Development

**Author:** Wilton B. Harrison  
**Date:** 2026  
**Classification:** Portfolio / Professional Development

---

## What This Project Does

Project 1 builds the **complete cloud foundation** — a hardened, 3-tier AWS VPC provisioned entirely through Terraform IaC. It mirrors real enterprise architecture used by companies like Boeing, Amazon, and DoD cloud environments. The infrastructure separates web, application, and data tiers into isolated subnet layers, each with its own security group chain enforcing least-privilege traffic flow.

A Python automation script (`deploy.py`) eliminates manual deployments by packaging application code, uploading it to an encrypted S3 bucket, and triggering deployment to EC2 via AWS SSM — producing a full audit trail with zero SSH access.

---

## Why It Matters for Cloud Engineering Roles

This project directly maps to the **#1 requirement** seen in top cloud engineering and AWS job postings: the ability to design and provision multi-tier, secure cloud infrastructure from scratch using IaC. It demonstrates:

- **Terraform proficiency** — providers, backends, modules, state management
- **AWS networking depth** — VPCs, subnets, IGW, NAT, route tables, SGs
- **Security-first design** — encryption at rest, no public S3, no SSH, IAM least-privilege
- **Automation mindset** — zero-touch deployments via Python + Boto3 + SSM

---

## Architecture Decision Highlights

| Decision | Rationale |
|---|---|
| 3-tier subnet separation | Defense in depth — breach in web tier cannot reach data tier |
| NAT Gateway (not IGW) for private tier | Private instances have outbound internet but are never directly reachable |
| SSM over SSH | Eliminates key management risk, full session logging, DoD-aligned |
| S3 remote Terraform state | Enables team collaboration, prevents state conflicts (DynamoDB lock) |
| Encrypted EBS + S3 | Meets NIST 800-53 SC-28 (protection of information at rest) |

---

## Tools & Open-Source Stack

| Tool | Role | License |
|---|---|---|
| Terraform (HashiCorp) | Infrastructure provisioning | MPL 2.0 |
| AWS Provider (HashiCorp) | AWS API abstraction | MPL 2.0 |
| Python 3 | Deployment automation | PSF |
| Boto3 (AWS SDK) | AWS API calls from Python | Apache 2.0 |
| Click | CLI framework for deploy script | BSD |
| Apache HTTP Server | Web server on EC2 | Apache 2.0 |

---

## Skills Demonstrated

`Terraform IaC` · `AWS VPC Design` · `Subnet Segmentation` · `Security Groups` · `IAM Roles` · `S3 Encryption` · `NAT Gateway` · `Python Automation` · `Boto3` · `AWS SSM` · `CI/CD Artifact Pipeline` · `NIST 800-53 Controls` · `Infrastructure Documentation`
