#!/bin/bash
# Emergency manual deploy script for Kubernetes
# In production, all deploys should go through GitHub Actions + ArgoCD.
# Use this only when CI/CD is unavailable.
set -euo pipefail

CLUSTER_NAME="agw-eks-cluster"
REGION="us-west-2"
NAMESPACE="agw-production"
DEPLOYMENT="agw-app"

echo "=== AGW Manual Deploy (K8s) ==="
echo "WARNING: Use CI/CD (GitHub Actions + ArgoCD) for production deploys."
echo ""

echo "1/5 Configuring kubectl context..."
aws eks update-kubeconfig --region $REGION --name $CLUSTER_NAME

echo "2/5 Getting ECR registry URL..."
ECR_REGISTRY=$(aws ecr describe-repositories \
  --repository-names agw-app \
  --region $REGION \
  --query 'repositories[0].repositoryUri' \
  --output text | sed 's|/agw-app||')

echo "3/5 Building and pushing Docker image..."
IMAGE_TAG="manual-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
docker build --target production -t $ECR_REGISTRY/agw-app:$IMAGE_TAG .
docker push $ECR_REGISTRY/agw-app:$IMAGE_TAG

echo "4/5 Updating deployment image..."
kubectl set image deployment/$DEPLOYMENT \
  agw-app=$ECR_REGISTRY/agw-app:$IMAGE_TAG \
  -n $NAMESPACE

echo "5/5 Waiting for rollout (timeout 5m)..."
kubectl rollout status deployment/$DEPLOYMENT -n $NAMESPACE --timeout=300s

echo ""
echo "Deploy complete: $IMAGE_TAG"
echo "To rollback: kubectl rollout undo deployment/$DEPLOYMENT -n $NAMESPACE"
echo "Rollout history: kubectl rollout history deployment/$DEPLOYMENT -n $NAMESPACE"
