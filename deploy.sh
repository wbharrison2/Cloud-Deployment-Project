#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-west-2}"
ECR_REPO="${ECR_REPO:?Set ECR_REPO}"
ECS_CLUSTER="agw-p4-cluster"
ECS_SERVICE="agw-p4-svc"
CF_DIST="${CLOUDFRONT_DISTRIBUTION_ID:?Set CLOUDFRONT_DISTRIBUTION_ID}"

echo "==> [1/6] ECR login"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REPO"

echo "==> [2/6] Build image"
IMAGE_TAG="$(git rev-parse --short HEAD)"
docker build -t "${ECR_REPO}:${IMAGE_TAG}" -t "${ECR_REPO}:latest" .

echo "==> [3/6] Push image"
docker push "${ECR_REPO}:${IMAGE_TAG}"
docker push "${ECR_REPO}:latest"

echo "==> [4/6] Terraform apply"
cd infrastructure
terraform init -input=false
terraform apply -auto-approve -var="container_image=${ECR_REPO}:${IMAGE_TAG}"
cd ..

echo "==> [5/6] Force ECS deploy (rolling, min 50% healthy)"
aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --force-new-deployment --region "$AWS_REGION" > /dev/null
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"

echo "==> [6/6] CloudFront invalidation"
aws cloudfront create-invalidation --distribution-id "$CF_DIST" --paths "/*"

echo ""
echo "Deploy complete. Image: ${ECR_REPO}:${IMAGE_TAG}"
echo "ECS tasks: 2 (one per AZ)"
