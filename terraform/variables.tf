variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-west-2"
}

variable "db_password" {
  description = "RDS PostgreSQL master password"
  type        = string
  sensitive   = true
}

variable "redis_auth_token" {
  description = "ElastiCache Redis auth token (min 16 characters)"
  type        = string
  sensitive   = true
}

variable "alb_dns_name" {
  description = "DNS name of the ALB created by NGINX Ingress Controller (available after helm install)"
  type        = string
  default     = ""
}
