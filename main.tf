# Project 4 — Franchise HA: Terraform
# PostgreSQL RDS Multi-AZ + ElastiCache Redis + ECS desired_count=2

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "agw-terraform-state"
    key    = "p4-franchise-ha/terraform.tfstate"
    region = "us-west-2"
  }
}

provider "aws" { region = var.aws_region }
provider "aws" { alias = "us_east_1"; region = "us-east-1" }

variable "aws_region"      { default = "us-west-2" }
variable "app_name"        { default = "agw-p4" }
variable "domain_name"     { default = "artisangemworks.com" }
variable "container_image" {}
variable "db_password"     { sensitive = true }

data "aws_availability_zones" "available" { state = "available" }

# ── VPC ─────────────────────────────────────────────────────────
resource "aws_vpc" "agw" { cidr_block = "10.0.0.0/16"; enable_dns_hostnames = true; tags = { Name = "${var.app_name}-vpc" } }
resource "aws_internet_gateway" "agw" { vpc_id = aws_vpc.agw.id }
resource "aws_subnet" "public" {
  count = 2; vpc_id = aws_vpc.agw.id
  cidr_block = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${var.app_name}-public-${count.index}" }
}
resource "aws_subnet" "private" {
  count = 2; vpc_id = aws_vpc.agw.id
  cidr_block = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "${var.app_name}-private-${count.index}" }
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.agw.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.agw.id }
}
resource "aws_route_table_association" "public" {
  count = 2; subnet_id = aws_subnet.public[count.index].id; route_table_id = aws_route_table.public.id
}

# ── Security groups ──────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name = "${var.app_name}-alb"; vpc_id = aws_vpc.agw.id
  ingress { from_port=80;  to_port=80;  protocol="tcp"; cidr_blocks=["0.0.0.0/0"] }
  ingress { from_port=443; to_port=443; protocol="tcp"; cidr_blocks=["0.0.0.0/0"] }
  egress  { from_port=0;   to_port=0;   protocol="-1"; cidr_blocks=["0.0.0.0/0"] }
}
resource "aws_security_group" "ecs" {
  name = "${var.app_name}-ecs"; vpc_id = aws_vpc.agw.id
  ingress { from_port=3000; to_port=3000; protocol="tcp"; security_groups=[aws_security_group.alb.id] }
  egress  { from_port=0;    to_port=0;    protocol="-1"; cidr_blocks=["0.0.0.0/0"] }
}
resource "aws_security_group" "rds" {
  name = "${var.app_name}-rds"; vpc_id = aws_vpc.agw.id
  ingress { from_port=5432; to_port=5432; protocol="tcp"; security_groups=[aws_security_group.ecs.id] }
  egress  { from_port=0;    to_port=0;    protocol="-1"; cidr_blocks=["0.0.0.0/0"] }
}
resource "aws_security_group" "redis" {
  name = "${var.app_name}-redis"; vpc_id = aws_vpc.agw.id
  ingress { from_port=6379; to_port=6379; protocol="tcp"; security_groups=[aws_security_group.ecs.id] }
  egress  { from_port=0;    to_port=0;    protocol="-1"; cidr_blocks=["0.0.0.0/0"] }
}

# ── RDS PostgreSQL 15 Multi-AZ ───────────────────────────────────────────
resource "aws_db_subnet_group" "agw" {
  name       = "${var.app_name}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
}
resource "aws_db_instance" "agw" {
  identifier             = "${var.app_name}-pg"
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = "db.t3.medium"
  allocated_storage      = 20
  max_allocated_storage  = 100
  db_name                = "agw"
  username               = "agw"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.agw.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = true
  storage_encrypted      = true
  backup_retention_period = 7
  deletion_protection    = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.app_name}-final"
  tags = { Name = "${var.app_name}-primary" }
}
resource "aws_db_instance" "read_replica" {
  identifier             = "${var.app_name}-pg-rr"
  replicate_source_db    = aws_db_instance.agw.identifier
  instance_class         = "db.t3.medium"
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot    = true
  tags = { Name = "${var.app_name}-read-replica" }
}

# ── ElastiCache Redis 7.2 ─────────────────────────────────────────────────
resource "aws_elasticache_subnet_group" "agw" {
  name       = "${var.app_name}-redis-subnets"
  subnet_ids = aws_subnet.private[*].id
}
resource "aws_elasticache_replication_group" "agw" {
  replication_group_id       = "${var.app_name}-redis"
  description                = "AGW P4 Redis"
  engine_version             = "7.2"
  node_type                  = "cache.t3.micro"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.agw.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}

# ── ACM + ALB + Route53 ─────────────────────────────────────────────────
resource "aws_acm_certificate" "cf" { provider=aws.us_east_1; domain_name=var.domain_name; subject_alternative_names=["www.${var.domain_name}"]; validation_method="DNS"; lifecycle{create_before_destroy=true} }
resource "aws_acm_certificate" "alb" { domain_name=var.domain_name; validation_method="DNS"; lifecycle{create_before_destroy=true} }
resource "aws_route53_zone" "agw" { name = var.domain_name }
resource "aws_lb" "agw" { name="${var.app_name}-alb"; load_balancer_type="application"; subnets=aws_subnet.public[*].id; security_groups=[aws_security_group.alb.id] }
resource "aws_lb_target_group" "app" {
  name="${var.app_name}-tg"; port=3000; protocol="HTTP"; vpc_id=aws_vpc.agw.id; target_type="ip"
  health_check { path="/health"; healthy_threshold=2; unhealthy_threshold=3; interval=15 }
}
resource "aws_lb_listener" "http" {
  load_balancer_arn=aws_lb.agw.arn; port=80; protocol="HTTP"
  default_action { type="redirect"; redirect { port="443"; protocol="HTTPS"; status_code="HTTP_301" } }
}
resource "aws_lb_listener" "https" {
  load_balancer_arn=aws_lb.agw.arn; port=443; protocol="HTTPS"
  ssl_policy="ELBSecurityPolicy-TLS13-1-2-2021-06"; certificate_arn=aws_acm_certificate.alb.arn
  default_action { type="forward"; target_group_arn=aws_lb_target_group.app.arn }
}

# ── CloudFront ────────────────────────────────────────────────────────────────
resource "aws_wafv2_web_acl" "agw" {
  provider=aws.us_east_1; name="${var.app_name}-waf"; scope="CLOUDFRONT"
  default_action { allow {} }
  rule { name="RateLimit"; priority=1; action{block{}}; statement{rate_based_statement{limit=2000;aggregate_key_type="IP"}}
    visibility_config{cloudwatch_metrics_enabled=true;metric_name="RateLimit";sampled_requests_enabled=true} }
  rule { name="AWSCommon"; priority=2; override_action{none{}}; statement{managed_rule_group_statement{name="AWSManagedRulesCommonRuleSet";vendor_name="AWS"}}
    visibility_config{cloudwatch_metrics_enabled=true;metric_name="AWSCommon";sampled_requests_enabled=true} }
  visibility_config{cloudwatch_metrics_enabled=true;metric_name="${var.app_name}-waf";sampled_requests_enabled=true}
}
resource "aws_cloudfront_distribution" "agw" {
  enabled=true; is_ipv6_enabled=true; aliases=[var.domain_name,"www.${var.domain_name}"]
  web_acl_id=aws_wafv2_web_acl.agw.arn; price_class="PriceClass_100"; wait_for_deployment=false
  origin { domain_name=aws_lb.agw.dns_name; origin_id="alb"
    custom_origin_config{http_port=80;https_port=443;origin_protocol_policy="https-only";origin_ssl_protocols=["TLSv1.2"]} }
  ordered_cache_behavior { path_pattern="/css/*"; allowed_methods=["GET","HEAD"]; cached_methods=["GET","HEAD"]; target_origin_id="alb"; viewer_protocol_policy="redirect-to-https"; min_ttl=0; default_ttl=604800; max_ttl=604800; compress=true; forwarded_values{query_string=false;cookies{forward="none"}} }
  ordered_cache_behavior { path_pattern="/js/*";  allowed_methods=["GET","HEAD"]; cached_methods=["GET","HEAD"]; target_origin_id="alb"; viewer_protocol_policy="redirect-to-https"; min_ttl=0; default_ttl=604800; max_ttl=604800; compress=true; forwarded_values{query_string=false;cookies{forward="none"}} }
  ordered_cache_behavior { path_pattern="/api/*"; allowed_methods=["DELETE","GET","HEAD","OPTIONS","PATCH","POST","PUT"]; cached_methods=["GET","HEAD"]; target_origin_id="alb"; viewer_protocol_policy="redirect-to-https"; min_ttl=0; default_ttl=0; max_ttl=0; compress=true; forwarded_values{query_string=true;cookies{forward="whitelist";whitelisted_names=["__Host-agw_token"]}} }
  default_cache_behavior { allowed_methods=["DELETE","GET","HEAD","OPTIONS","PATCH","POST","PUT"]; cached_methods=["GET","HEAD"]; target_origin_id="alb"; viewer_protocol_policy="redirect-to-https"; min_ttl=0; default_ttl=0; max_ttl=0; compress=true; forwarded_values{query_string=true;cookies{forward="all"}} }
  restrictions { geo_restriction{restriction_type="none"} }
  viewer_certificate { acm_certificate_arn=aws_acm_certificate.cf.arn; ssl_support_method="sni-only"; minimum_protocol_version="TLSv1.2_2021" }
}
resource "aws_route53_record" "apex" { zone_id=aws_route53_zone.agw.zone_id; name=var.domain_name; type="A"; alias{name=aws_cloudfront_distribution.agw.domain_name;zone_id=aws_cloudfront_distribution.agw.hosted_zone_id;evaluate_target_health=false} }

# ── ECS Fargate desired_count=2 ────────────────────────────────────────────────
resource "aws_ecs_cluster" "agw" { name = "${var.app_name}-cluster" }
resource "aws_iam_role" "exec" {
  name = "${var.app_name}-ecs-exec"
  assume_role_policy = jsonencode({Version="2012-10-17";Statement=[{Effect="Allow";Principal={Service="ecs-tasks.amazonaws.com"};Action="sts:AssumeRole"}]})
}
resource "aws_iam_role_policy_attachment" "exec" { role=aws_iam_role.exec.name; policy_arn="arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" }
resource "aws_iam_role_policy" "cf_invalidate" {
  name="cf-invalidate"; role=aws_iam_role.exec.id
  policy=jsonencode({Version="2012-10-17";Statement=[{Effect="Allow";Action=["cloudfront:CreateInvalidation"];Resource="*"}]})
}
resource "aws_ecs_task_definition" "app" {
  family="${var.app_name}"; network_mode="awsvpc"; requires_compatibilities=["FARGATE"]
  cpu="512"; memory="1024"; execution_role_arn=aws_iam_role.exec.arn; task_role_arn=aws_iam_role.exec.arn
  container_definitions = jsonencode([{
    name="app"; image=var.container_image; essential=true
    portMappings=[{containerPort=3000}]
    environment=[
      {name="NODE_ENV";value="production"},{name="PORT";value="3000"},
      {name="DATABASE_URL";value="postgresql://agw:${var.db_password}@${aws_db_instance.agw.address}:5432/agw"},
      {name="REDIS_URL";value="rediss://${aws_elasticache_replication_group.agw.primary_endpoint_address}:6379"},
      {name="COOKIE_SECRET";value="REPLACE_WITH_SECRET"},{name="TOTP_ISSUER";value="Artisan Gem Works"}
    ]
    logConfiguration={logDriver="awslogs";options={"awslogs-group"="/ecs/${var.app_name}";"awslogs-region"=var.aws_region;"awslogs-stream-prefix"="app"}}
  }])
}
resource "aws_ecs_service" "app" {
  name="${var.app_name}-svc"; cluster=aws_ecs_cluster.agw.id
  task_definition=aws_ecs_task_definition.app.arn
  desired_count=2; launch_type="FARGATE"
  deployment_minimum_healthy_percent=50
  deployment_maximum_percent=200
  network_configuration { subnets=aws_subnet.public[*].id; security_groups=[aws_security_group.ecs.id]; assign_public_ip=true }
  load_balancer { target_group_arn=aws_lb_target_group.app.arn; container_name="app"; container_port=3000 }
}
resource "aws_cloudwatch_log_group" "app" { name="/ecs/${var.app_name}"; retention_in_days=30 }

output "cloudfront_domain" { value = aws_cloudfront_distribution.agw.domain_name }
output "rds_endpoint"      { value = aws_db_instance.agw.address }
output "redis_endpoint"    { value = aws_elasticache_replication_group.agw.primary_endpoint_address }
