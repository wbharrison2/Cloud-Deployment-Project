#!/usr/bin/env bash
# deploy.sh — Enterprise Project 4: Multi-Region HA Platform
# Validates, deploys, and tests the enterprise HA infrastructure.
# Usage: ./deploy.sh [--region REGION] [--account-id ACCOUNT_ID] [--verify]
set -euo pipefail

###############################################################################
# COLORS
###############################################################################
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[$(date '+%H:%M:%S')] INFO  $*${NC}"; }
success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] OK    $*${NC}"; }
warn()    { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN  $*${NC}"; }
error()   { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR $*${NC}" >&2; exit 1; }

###############################################################################
# ARGUMENTS
###############################################################################
AWS_REGION="us-east-1"
DR_REGION="us-west-2"
ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
VERIFY_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --region)     AWS_REGION="$2"; shift 2 ;;
    --account-id) ACCOUNT_ID="$2"; shift 2 ;;
    --verify)     VERIFY_ONLY=true; shift ;;
    *) error "Unknown argument: $1" ;;
  esac
done

[[ -z "$ACCOUNT_ID" ]] && error "AWS account ID required. Set AWS_ACCOUNT_ID or pass --account-id"

###############################################################################
# STEP 1: PRE-FLIGHT CHECKS
###############################################################################
info "Step 1/6: Pre-flight checks"

for cmd in terraform aws jq; do
  command -v "$cmd" &>/dev/null || error "Required tool not found: $cmd"
done

TERRAFORM_VERSION=$(terraform version -json | jq -r '.terraform_version')
info "Terraform version: $TERRAFORM_VERSION"

aws sts get-caller-identity --region "$AWS_REGION" &>/dev/null \
  || error "AWS credentials not configured or invalid"
CALLER=$(aws sts get-caller-identity --region "$AWS_REGION" --query 'Arn' --output text)
success "AWS identity confirmed: $CALLER"

###############################################################################
# STEP 2: VALIDATE TERRAFORM
###############################################################################
info "Step 2/6: Terraform validation"

terraform init -backend=false -input=false &>/dev/null
terraform validate
success "Terraform configuration valid"

if [[ "$VERIFY_ONLY" == "true" ]]; then
  info "Verify-only mode — skipping apply"
  exit 0
fi

###############################################################################
# STEP 3: TERRAFORM INIT + PLAN
###############################################################################
info "Step 3/6: Terraform init and plan"

terraform init -input=false
terraform plan \
  -var="primary_region=${AWS_REGION}" \
  -var="dr_region=${DR_REGION}" \
  -var="alert_email=alerts@example.com" \
  -out=ha-platform.tfplan

success "Terraform plan created: ha-platform.tfplan"

###############################################################################
# STEP 4: APPLY
###############################################################################
info "Step 4/6: Applying infrastructure (multi-region — may take 15-20 min)"
warn "This will create resources in ${AWS_REGION} AND ${DR_REGION}"
read -rp "$(echo -e "${YELLOW}Proceed? [y/N]: ${NC}")" CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted"; exit 0; }

terraform apply -auto-approve ha-platform.tfplan
success "Infrastructure deployed"

###############################################################################
# STEP 5: VERIFY DEPLOYMENT
###############################################################################
info "Step 5/6: Deployment verification"

PRIMARY_ALB=$(terraform output -raw primary_alb_dns 2>/dev/null || echo "")
DR_ALB=$(terraform output -raw dr_alb_dns 2>/dev/null || echo "")
CF_DOMAIN=$(terraform output -raw cloudfront_domain 2>/dev/null || echo "")

if [[ -n "$PRIMARY_ALB" ]]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 \
    "http://${PRIMARY_ALB}/health" || echo "000")
  [[ "$STATUS" == "200" ]] \
    && success "Primary ALB health check: HTTP $STATUS" \
    || warn "Primary ALB health check: HTTP $STATUS (instances may still be warming up)"
fi

if [[ -n "$DR_ALB" ]]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 \
    "http://${DR_ALB}/health" || echo "000")
  [[ "$STATUS" == "200" ]] \
    && success "DR ALB health check: HTTP $STATUS" \
    || warn "DR ALB health check: HTTP $STATUS (warm standby — expected if not yet active)"
fi

###############################################################################
# STEP 6: MONITORING SUMMARY
###############################################################################
info "Step 6/6: Post-deploy monitoring summary"

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ENTERPRISE PROJECT 4 — DEPLOYMENT COMPLETE${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo ""

PRIMARY_ALB=$(terraform output -raw primary_alb_dns 2>/dev/null || echo "pending")
DR_ALB=$(terraform output -raw dr_alb_dns 2>/dev/null || echo "pending")
CF_DOMAIN=$(terraform output -raw cloudfront_domain 2>/dev/null || echo "pending")
CW_DASH=$(terraform output -raw cw_dashboard 2>/dev/null || echo "check console")

echo -e "  ${CYAN}Application (CloudFront):${NC}  https://${CF_DOMAIN}"
echo -e "  ${CYAN}Primary ALB:               ${NC}  http://${PRIMARY_ALB}"
echo -e "  ${CYAN}DR ALB (warm standby):     ${NC}  http://${DR_ALB}"
echo -e "  ${CYAN}CloudWatch Dashboard:      ${NC}  ${CW_DASH}"
echo ""
echo -e "  ${GREEN}Passive Monitoring:${NC}"
echo -e "   - CloudWatch Alarms:  CPU, unhealthy hosts, 5xx, RDS CPU, RDS storage"
echo -e "   - SNS email alerts:   alerts@example.com (confirm subscription in email)"
echo ""
echo -e "  ${GREEN}Active Monitoring:${NC}"
echo -e "   - GuardDuty:         Enabled in ${AWS_REGION} + ${DR_REGION}"
echo -e "   - Lambda:            Auto-quarantine HIGH/CRITICAL findings"
echo -e "   - EventBridge:       GuardDuty → Lambda → SNS pipeline active"
echo ""
echo -e "  ${YELLOW}DR Test:${NC}"
echo -e "   aws route53 get-health-check-status \\"
echo -e "     --health-check-id \$(terraform output -raw ...)"
echo -e "   # When primary fails, Route53 auto-routes to DR ALB"
echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
