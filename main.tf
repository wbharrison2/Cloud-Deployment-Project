###############################################################################
# ENTERPRISE PROJECT 4 — MULTI-REGION HIGH AVAILABILITY PLATFORM
# Author : Wilton B. Harrison
# Source : Based on Project 1 — Cloud Infrastructure & Development
#          https://github.com/wbharrison2/Cloud-Deployment-Project
# Purpose: Enterprise-grade multi-region active-passive HA platform.
#          Scales Project 1's single-region EC2 to multi-region Auto Scaling
#          Groups, RDS Multi-AZ with cross-region read replica, S3 cross-region
#          replication, Route53 failover, CloudFront CDN, WAF OWASP rules,
#          and automated threat response via GuardDuty + Lambda.
# Tools  : Terraform >= 1.6, AWS Provider >= 5.0 (open-source)
###############################################################################

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "wbh-terraform-state"
    key            = "enterprise4/ha-platform/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "wbh-tf-lock"
  }
}

provider "aws" {
  alias  = "primary"
  region = var.primary_region
  default_tags {
    tags = {
      Project     = "Enterprise-HA-Platform"
      Owner       = "Wilton B. Harrison"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags {
    tags = {
      Project     = "Enterprise-HA-Platform"
      Owner       = "Wilton B. Harrison"
      Environment = "${var.environment}-dr"
      ManagedBy   = "Terraform"
    }
  }
}

# WAF + CloudFront must be provisioned in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project   = "Enterprise-HA-Platform"
      ManagedBy = "Terraform"
    }
  }
}

###############################################################################
# VARIABLES
###############################################################################

variable "primary_region"   { default = "us-east-1" }
variable "dr_region"        { default = "us-west-2" }
variable "environment"      { default = "prod" }
variable "project_name"     { default = "wbh-ha-platform" }

variable "primary_vpc_cidr"          { default = "10.0.0.0/16" }
variable "dr_vpc_cidr"               { default = "10.1.0.0/16" }
variable "primary_public_subnets"    { default = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"] }
variable "primary_private_subnets"   { default = ["10.0.10.0/24", "10.0.11.0/24", "10.0.12.0/24"] }
variable "primary_data_subnets"      { default = ["10.0.20.0/24", "10.0.21.0/24", "10.0.22.0/24"] }
variable "dr_public_subnets"         { default = ["10.1.1.0/24", "10.1.2.0/24"] }
variable "dr_private_subnets"        { default = ["10.1.10.0/24", "10.1.11.0/24"] }
variable "dr_data_subnets"           { default = ["10.1.20.0/24", "10.1.21.0/24"] }

variable "instance_type"             { default = "t3.small" }
variable "ami_id_primary"            { default = "ami-0c02fb55956c7d316" }
variable "ami_id_dr"                 { default = "ami-0892d3c7ee96c0bf7" }
variable "asg_min_size"              { default = 2 }
variable "asg_max_size"              { default = 20 }
variable "asg_desired"               { default = 3 }

variable "db_instance_class"         { default = "db.t3.micro" }
variable "db_name"                   { default = "wbhapp" }
variable "db_username"               { default = "wbhadmin" }
variable "db_password"               {
  default   = "REPLACE_WITH_SECRETS_MANAGER_VALUE"
  sensitive = true
}

variable "alert_email"               { default = "alerts@example.com" }
variable "waf_rate_limit"            { default = 2000 }

###############################################################################
# DATA SOURCES
###############################################################################

data "aws_availability_zones" "primary" {
  provider = aws.primary
  state    = "available"
}

data "aws_availability_zones" "dr" {
  provider = aws.dr
  state    = "available"
}

data "aws_caller_identity" "current" {
  provider = aws.primary
}

###############################################################################
# KMS — ENCRYPTION KEY (primary region, drives EBS + RDS + SNS + CW Logs)
###############################################################################

resource "aws_kms_key" "primary" {
  provider                = aws.primary
  description             = "${var.project_name} primary CMK"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "${var.project_name}-kms-primary" }
}

resource "aws_kms_alias" "primary" {
  provider      = aws.primary
  name          = "alias/${var.project_name}-primary"
  target_key_id = aws_kms_key.primary.key_id
}

###############################################################################
# NETWORKING — PRIMARY REGION (3-tier, 3 AZs for true enterprise HA)
###############################################################################

resource "aws_vpc" "primary" {
  provider             = aws.primary
  cidr_block           = var.primary_vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project_name}-primary-vpc" }
}

resource "aws_internet_gateway" "primary" {
  provider = aws.primary
  vpc_id   = aws_vpc.primary.id
  tags     = { Name = "${var.project_name}-primary-igw" }
}

resource "aws_subnet" "primary_public" {
  provider                = aws.primary
  count                   = length(var.primary_public_subnets)
  vpc_id                  = aws_vpc.primary.id
  cidr_block              = var.primary_public_subnets[count.index]
  availability_zone       = data.aws_availability_zones.primary.names[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.project_name}-primary-pub-${count.index + 1}", Tier = "Public" }
}

resource "aws_subnet" "primary_private" {
  provider          = aws.primary
  count             = length(var.primary_private_subnets)
  vpc_id            = aws_vpc.primary.id
  cidr_block        = var.primary_private_subnets[count.index]
  availability_zone = data.aws_availability_zones.primary.names[count.index]
  tags              = { Name = "${var.project_name}-primary-priv-${count.index + 1}", Tier = "App" }
}

resource "aws_subnet" "primary_data" {
  provider          = aws.primary
  count             = length(var.primary_data_subnets)
  vpc_id            = aws_vpc.primary.id
  cidr_block        = var.primary_data_subnets[count.index]
  availability_zone = data.aws_availability_zones.primary.names[count.index]
  tags              = { Name = "${var.project_name}-primary-data-${count.index + 1}", Tier = "Data" }
}

resource "aws_eip" "primary_nat" {
  provider = aws.primary
  count    = 3
  domain   = "vpc"
  tags     = { Name = "${var.project_name}-nat-eip-${count.index + 1}" }
}

resource "aws_nat_gateway" "primary" {
  provider      = aws.primary
  count         = 3
  allocation_id = aws_eip.primary_nat[count.index].id
  subnet_id     = aws_subnet.primary_public[count.index].id
  depends_on    = [aws_internet_gateway.primary]
  tags          = { Name = "${var.project_name}-nat-${count.index + 1}" }
}

resource "aws_route_table" "primary_public" {
  provider = aws.primary
  vpc_id   = aws_vpc.primary.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.primary.id }
  tags = { Name = "${var.project_name}-rt-primary-public" }
}

resource "aws_route_table" "primary_private" {
  provider = aws.primary
  count    = 3
  vpc_id   = aws_vpc.primary.id
  route { cidr_block = "0.0.0.0/0"; nat_gateway_id = aws_nat_gateway.primary[count.index].id }
  tags = { Name = "${var.project_name}-rt-primary-priv-${count.index + 1}" }
}

resource "aws_route_table_association" "primary_public" {
  provider       = aws.primary
  count          = length(aws_subnet.primary_public)
  subnet_id      = aws_subnet.primary_public[count.index].id
  route_table_id = aws_route_table.primary_public.id
}

resource "aws_route_table_association" "primary_private" {
  provider       = aws.primary
  count          = length(aws_subnet.primary_private)
  subnet_id      = aws_subnet.primary_private[count.index].id
  route_table_id = aws_route_table.primary_private[count.index].id
}

###############################################################################
# NETWORKING — DR REGION
###############################################################################

resource "aws_vpc" "dr" {
  provider             = aws.dr
  cidr_block           = var.dr_vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project_name}-dr-vpc" }
}

resource "aws_internet_gateway" "dr" {
  provider = aws.dr
  vpc_id   = aws_vpc.dr.id
  tags     = { Name = "${var.project_name}-dr-igw" }
}

resource "aws_subnet" "dr_public" {
  provider                = aws.dr
  count                   = length(var.dr_public_subnets)
  vpc_id                  = aws_vpc.dr.id
  cidr_block              = var.dr_public_subnets[count.index]
  availability_zone       = data.aws_availability_zones.dr.names[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.project_name}-dr-pub-${count.index + 1}", Tier = "Public" }
}

resource "aws_subnet" "dr_private" {
  provider          = aws.dr
  count             = length(var.dr_private_subnets)
  vpc_id            = aws_vpc.dr.id
  cidr_block        = var.dr_private_subnets[count.index]
  availability_zone = data.aws_availability_zones.dr.names[count.index]
  tags              = { Name = "${var.project_name}-dr-priv-${count.index + 1}", Tier = "App" }
}

resource "aws_subnet" "dr_data" {
  provider          = aws.dr
  count             = length(var.dr_data_subnets)
  vpc_id            = aws_vpc.dr.id
  cidr_block        = var.dr_data_subnets[count.index]
  availability_zone = data.aws_availability_zones.dr.names[count.index]
  tags              = { Name = "${var.project_name}-dr-data-${count.index + 1}", Tier = "Data" }
}

resource "aws_eip" "dr_nat" {
  provider = aws.dr
  domain   = "vpc"
  tags     = { Name = "${var.project_name}-dr-nat-eip" }
}

resource "aws_nat_gateway" "dr" {
  provider      = aws.dr
  allocation_id = aws_eip.dr_nat.id
  subnet_id     = aws_subnet.dr_public[0].id
  depends_on    = [aws_internet_gateway.dr]
  tags          = { Name = "${var.project_name}-dr-nat" }
}

resource "aws_route_table" "dr_public" {
  provider = aws.dr
  vpc_id   = aws_vpc.dr.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.dr.id }
  tags = { Name = "${var.project_name}-rt-dr-public" }
}

resource "aws_route_table" "dr_private" {
  provider = aws.dr
  vpc_id   = aws_vpc.dr.id
  route { cidr_block = "0.0.0.0/0"; nat_gateway_id = aws_nat_gateway.dr.id }
  tags = { Name = "${var.project_name}-rt-dr-private" }
}

resource "aws_route_table_association" "dr_public" {
  provider       = aws.dr
  count          = length(aws_subnet.dr_public)
  subnet_id      = aws_subnet.dr_public[count.index].id
  route_table_id = aws_route_table.dr_public.id
}

resource "aws_route_table_association" "dr_private" {
  provider       = aws.dr
  count          = length(aws_subnet.dr_private)
  subnet_id      = aws_subnet.dr_private[count.index].id
  route_table_id = aws_route_table.dr_private.id
}

###############################################################################
# SECURITY GROUPS — PRIMARY
###############################################################################

resource "aws_security_group" "primary_alb" {
  provider    = aws.primary
  name        = "${var.project_name}-sg-alb-primary"
  description = "ALB: HTTP/HTTPS from internet, drop invalid headers"
  vpc_id      = aws_vpc.primary.id

  ingress { from_port = 80;  to_port = 80;  protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0;   to_port = 0;   protocol = "-1";  cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "${var.project_name}-sg-alb-primary" }
}

resource "aws_security_group" "primary_app" {
  provider    = aws.primary
  name        = "${var.project_name}-sg-app-primary"
  description = "App tier: inbound only from ALB"
  vpc_id      = aws_vpc.primary.id

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.primary_alb.id]
  }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "${var.project_name}-sg-app-primary" }
}

resource "aws_security_group" "primary_rds" {
  provider    = aws.primary
  name        = "${var.project_name}-sg-rds-primary"
  description = "RDS: inbound only from app tier"
  vpc_id      = aws_vpc.primary.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.primary_app.id]
  }
  tags = { Name = "${var.project_name}-sg-rds-primary" }
}

###############################################################################
# SECURITY GROUPS — DR
###############################################################################

resource "aws_security_group" "dr_alb" {
  provider    = aws.dr
  name        = "${var.project_name}-sg-alb-dr"
  description = "DR ALB: HTTP/HTTPS from internet"
  vpc_id      = aws_vpc.dr.id

  ingress { from_port = 80;  to_port = 80;  protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0;   to_port = 0;   protocol = "-1";  cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "${var.project_name}-sg-alb-dr" }
}

resource "aws_security_group" "dr_app" {
  provider    = aws.dr
  name        = "${var.project_name}-sg-app-dr"
  description = "DR App: inbound only from DR ALB"
  vpc_id      = aws_vpc.dr.id

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.dr_alb.id]
  }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "${var.project_name}-sg-app-dr" }
}

###############################################################################
# IAM — EC2 + LAMBDA ROLES
###############################################################################

resource "aws_iam_role" "ec2_role" {
  provider = aws.primary
  name     = "${var.project_name}-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "ec2.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  provider   = aws.primary
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ec2_cw" {
  provider   = aws.primary
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "ec2" {
  provider = aws.primary
  name     = "${var.project_name}-ec2-profile"
  role     = aws_iam_role.ec2_role.name
}

resource "aws_iam_role" "rds_monitoring" {
  provider = aws.primary
  name     = "${var.project_name}-rds-monitoring-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "monitoring.rds.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  provider   = aws.primary
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

###############################################################################
# S3 — ARTIFACTS WITH CROSS-REGION REPLICATION
###############################################################################

resource "aws_s3_bucket" "artifacts_primary" {
  provider      = aws.primary
  bucket        = "${var.project_name}-artifacts-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
  tags          = { Name = "${var.project_name}-artifacts-primary" }
}

resource "aws_s3_bucket_versioning" "artifacts_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.artifacts_primary.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts_primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.artifacts_primary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.primary.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts_primary" {
  provider                = aws.primary
  bucket                  = aws_s3_bucket.artifacts_primary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "artifacts_dr" {
  provider      = aws.dr
  bucket        = "${var.project_name}-artifacts-dr-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
  tags          = { Name = "${var.project_name}-artifacts-dr" }
}

resource "aws_s3_bucket_versioning" "artifacts_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.artifacts_dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.artifacts_dr.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts_dr" {
  provider                = aws.dr
  bucket                  = aws_s3_bucket.artifacts_dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role" "s3_replication" {
  provider = aws.primary
  name     = "${var.project_name}-s3-replication-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "s3.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_policy" "s3_replication" {
  provider = aws.primary
  name     = "${var.project_name}-s3-replication-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow"; Action = ["s3:GetReplicationConfiguration", "s3:ListBucket"]; Resource = [aws_s3_bucket.artifacts_primary.arn] },
      { Effect = "Allow"; Action = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]; Resource = ["${aws_s3_bucket.artifacts_primary.arn}/*"] },
      { Effect = "Allow"; Action = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]; Resource = ["${aws_s3_bucket.artifacts_dr.arn}/*"] }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "s3_replication" {
  provider   = aws.primary
  role       = aws_iam_role.s3_replication.name
  policy_arn = aws_iam_policy.s3_replication.arn
}

resource "aws_s3_bucket_replication_configuration" "artifacts" {
  provider   = aws.primary
  depends_on = [aws_s3_bucket_versioning.artifacts_primary]
  bucket     = aws_s3_bucket.artifacts_primary.id
  role       = aws_iam_role.s3_replication.arn

  rule {
    id     = "replicate-all"
    status = "Enabled"
    destination {
      bucket        = aws_s3_bucket.artifacts_dr.arn
      storage_class = "STANDARD_IA"
    }
  }
}

resource "aws_s3_bucket" "alb_logs" {
  provider      = aws.primary
  bucket        = "${var.project_name}-alb-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = { Name = "${var.project_name}-alb-logs" }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  provider                = aws.primary
  bucket                  = aws_s3_bucket.alb_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

###############################################################################
# ALB — PRIMARY
###############################################################################

resource "aws_lb" "primary" {
  provider                   = aws.primary
  name                       = "${var.project_name}-alb-primary"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.primary_alb.id]
  subnets                    = aws_subnet.primary_public[*].id
  enable_deletion_protection = false
  drop_invalid_header_fields = true

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.bucket
    prefix  = "alb-primary"
    enabled = true
  }
  tags = { Name = "${var.project_name}-alb-primary" }
}

resource "aws_lb_target_group" "primary" {
  provider    = aws.primary
  name        = "${var.project_name}-tg-primary"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.primary.id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }
  tags = { Name = "${var.project_name}-tg-primary" }
}

resource "aws_lb_listener" "primary_http" {
  provider          = aws.primary
  load_balancer_arn = aws_lb.primary.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.primary.arn
  }
}

###############################################################################
# ALB — DR
###############################################################################

resource "aws_lb" "dr" {
  provider                   = aws.dr
  name                       = "${var.project_name}-alb-dr"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.dr_alb.id]
  subnets                    = aws_subnet.dr_public[*].id
  enable_deletion_protection = false
  drop_invalid_header_fields = true
  tags                       = { Name = "${var.project_name}-alb-dr" }
}

resource "aws_lb_target_group" "dr" {
  provider    = aws.dr
  name        = "${var.project_name}-tg-dr"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.dr.id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }
  tags = { Name = "${var.project_name}-tg-dr" }
}

resource "aws_lb_listener" "dr_http" {
  provider          = aws.dr
  load_balancer_arn = aws_lb.dr.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dr.arn
  }
}

###############################################################################
# LAUNCH TEMPLATE — PRIMARY (IMDSv2 required, encrypted EBS, CW agent)
###############################################################################

resource "aws_launch_template" "primary" {
  provider      = aws.primary
  name_prefix   = "${var.project_name}-lt-primary-"
  image_id      = var.ami_id_primary
  instance_type = var.instance_type

  iam_instance_profile { name = aws_iam_instance_profile.ec2.name }
  vpc_security_group_ids = [aws_security_group.primary_app.id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_type           = "gp3"
      volume_size           = 30
      encrypted             = true
      kms_key_id            = aws_kms_key.primary.arn
      delete_on_termination = true
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"  # IMDSv2 — blocks SSRF credential theft
    http_put_response_hop_limit = 1
  }

  monitoring { enabled = true }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    yum update -y
    yum install -y amazon-cloudwatch-agent httpd
    systemctl start httpd && systemctl enable httpd
    echo "<h1>Enterprise Project 4 — HA Platform | PRIMARY | WBH</h1>" > /var/www/html/index.html
    printf "OK" > /var/www/html/health
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
      -a fetch-config -m ec2 -s -c default
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = { Name = "${var.project_name}-primary-server", Region = var.primary_region }
  }

  lifecycle { create_before_destroy = true }
}

###############################################################################
# LAUNCH TEMPLATE — DR (minimal: activates on failover)
###############################################################################

resource "aws_launch_template" "dr" {
  provider      = aws.dr
  name_prefix   = "${var.project_name}-lt-dr-"
  image_id      = var.ami_id_dr
  instance_type = var.instance_type

  vpc_security_group_ids = [aws_security_group.dr_app.id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_type           = "gp3"
      volume_size           = 30
      encrypted             = true
      delete_on_termination = true
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  monitoring { enabled = true }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    yum update -y
    yum install -y httpd
    systemctl start httpd && systemctl enable httpd
    echo "<h1>Enterprise Project 4 — HA Platform | DR | WBH</h1>" > /var/www/html/index.html
    printf "OK" > /var/www/html/health
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = { Name = "${var.project_name}-dr-server", Region = var.dr_region }
  }

  lifecycle { create_before_destroy = true }
}

###############################################################################
# AUTO SCALING GROUPS
###############################################################################

resource "aws_autoscaling_group" "primary" {
  provider                  = aws.primary
  name                      = "${var.project_name}-asg-primary"
  vpc_zone_identifier       = aws_subnet.primary_private[*].id
  target_group_arns         = [aws_lb_target_group.primary.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 120
  min_size                  = var.asg_min_size
  max_size                  = var.asg_max_size
  desired_capacity          = var.asg_desired

  launch_template {
    id      = aws_launch_template.primary.id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 90
      instance_warmup        = 60
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-primary-instance"
    propagate_at_launch = true
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_autoscaling_group" "dr" {
  provider                  = aws.dr
  name                      = "${var.project_name}-asg-dr"
  vpc_zone_identifier       = aws_subnet.dr_private[*].id
  target_group_arns         = [aws_lb_target_group.dr.arn]
  health_check_type         = "ELB"
  health_check_grace_period = 120
  min_size                  = 1
  max_size                  = var.asg_max_size
  desired_capacity          = 1  # Warm standby until failover

  launch_template {
    id      = aws_launch_template.dr.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-dr-instance"
    propagate_at_launch = true
  }

  lifecycle { create_before_destroy = true }
}

###############################################################################
# AUTO SCALING POLICIES — CPU + ALB request rate
###############################################################################

resource "aws_autoscaling_policy" "primary_cpu" {
  provider               = aws.primary
  name                   = "${var.project_name}-asg-cpu-tracking"
  autoscaling_group_name = aws_autoscaling_group.primary.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 70.0
  }
}

resource "aws_autoscaling_policy" "primary_alb_requests" {
  provider               = aws.primary
  name                   = "${var.project_name}-asg-alb-tracking"
  autoscaling_group_name = aws_autoscaling_group.primary.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.primary.arn_suffix}/${aws_lb_target_group.primary.arn_suffix}"
    }
    target_value = 1000.0  # Scale out at 1000 req/s per target
  }
}

###############################################################################
# RDS — MULTI-AZ POSTGRESQL (primary) + CROSS-REGION READ REPLICA (DR)
###############################################################################

resource "aws_db_subnet_group" "primary" {
  provider   = aws.primary
  name       = "${var.project_name}-rds-subnet-group"
  subnet_ids = aws_subnet.primary_data[*].id
  tags       = { Name = "${var.project_name}-rds-subnet-group" }
}

resource "aws_db_instance" "primary" {
  provider                        = aws.primary
  identifier                      = "${var.project_name}-rds-primary"
  engine                          = "postgres"
  engine_version                  = "15.4"
  instance_class                  = var.db_instance_class
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.primary.arn
  db_name                         = var.db_name
  username                        = var.db_username
  password                        = var.db_password
  db_subnet_group_name            = aws_db_subnet_group.primary.name
  vpc_security_group_ids          = [aws_security_group.primary_rds.id]
  multi_az                        = true
  backup_retention_period         = 7
  backup_window                   = "03:00-04:00"
  maintenance_window              = "sun:04:00-sun:05:00"
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.project_name}-rds-final-snapshot"
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  tags                            = { Name = "${var.project_name}-rds-primary" }
}

resource "aws_db_subnet_group" "dr" {
  provider   = aws.dr
  name       = "${var.project_name}-rds-subnet-group-dr"
  subnet_ids = aws_subnet.dr_data[*].id
  tags       = { Name = "${var.project_name}-rds-subnet-group-dr" }
}

resource "aws_db_instance" "dr_replica" {
  provider               = aws.dr
  identifier             = "${var.project_name}-rds-dr-replica"
  instance_class         = var.db_instance_class
  replicate_source_db    = aws_db_instance.primary.arn
  db_subnet_group_name   = aws_db_subnet_group.dr.name
  storage_encrypted      = true
  skip_final_snapshot    = true
  deletion_protection    = false
  publicly_accessible    = false
  tags                   = { Name = "${var.project_name}-rds-dr-replica" }
}

###############################################################################
# ROUTE53 — HEALTH CHECKS (passive detection, enable DNS failover)
###############################################################################

resource "aws_route53_health_check" "primary" {
  provider          = aws.primary
  fqdn              = aws_lb.primary.dns_name
  port              = 80
  type              = "HTTP"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30
  tags              = { Name = "${var.project_name}-health-check-primary" }
}

resource "aws_route53_health_check" "dr" {
  provider          = aws.primary
  fqdn              = aws_lb.dr.dns_name
  port              = 80
  type              = "HTTP"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30
  tags              = { Name = "${var.project_name}-health-check-dr" }
}

###############################################################################
# WAF — OWASP MANAGED RULES + RATE LIMITING (CloudFront scope)
###############################################################################

resource "aws_wafv2_web_acl" "main" {
  provider    = aws.us_east_1
  name        = "${var.project_name}-waf"
  description = "OWASP managed rules + rate limiting for enterprise traffic"
  scope       = "CLOUDFRONT"

  default_action { allow {} }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputs"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesSQLi"
    priority = 3
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLiRuleSet"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "IPRateLimitRule"
    priority = 4
    action { block {} }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-waf-main"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${var.project_name}-waf" }
}

###############################################################################
# CLOUDFRONT — GLOBAL CDN WITH WAF
###############################################################################

resource "aws_s3_bucket" "cloudfront_logs" {
  provider      = aws.us_east_1
  bucket        = "${var.project_name}-cf-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = { Name = "${var.project_name}-cf-logs" }
}

resource "aws_cloudfront_distribution" "main" {
  provider    = aws.us_east_1
  enabled     = true
  comment     = "${var.project_name} CDN — WAF-protected global delivery"
  price_class = "PriceClass_100"
  web_acl_id  = aws_wafv2_web_acl.main.arn

  origin {
    domain_name = aws_lb.primary.dns_name
    origin_id   = "primary-alb"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    domain_name = aws_lb.dr.dns_name
    origin_id   = "dr-alb"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin_group {
    origin_id = "ha-origin-group"
    failover_criteria {
      status_codes = [500, 502, 503, 504]
    }
    member { origin_id = "primary-alb" }
    member { origin_id = "dr-alb" }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "ha-origin-group"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Host", "Authorization", "Accept-Encoding"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  logging_config {
    bucket          = aws_s3_bucket.cloudfront_logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }

  tags = { Name = "${var.project_name}-cloudfront" }
}

###############################################################################
# SNS — ALERT NOTIFICATION TOPIC
###############################################################################

resource "aws_sns_topic" "alerts" {
  provider          = aws.primary
  name              = "${var.project_name}-alerts"
  kms_master_key_id = aws_kms_key.primary.id
  tags              = { Name = "${var.project_name}-alerts" }
}

resource "aws_sns_topic_subscription" "email" {
  provider  = aws.primary
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

###############################################################################
# CLOUDWATCH — PASSIVE MONITORING
# Dashboards + alarms that observe and report without auto-intervention
###############################################################################

resource "aws_cloudwatch_log_group" "app" {
  provider          = aws.primary
  name              = "/app/${var.project_name}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.primary.arn
  tags              = { Name = "${var.project_name}-app-logs" }
}

resource "aws_cloudwatch_dashboard" "main" {
  provider       = aws.primary
  dashboard_name = "${var.project_name}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"; width = 12; height = 6
        properties = {
          title   = "ASG Instance Count — Primary"
          metrics = [
            ["AWS/AutoScaling", "GroupInServiceInstances", "AutoScalingGroupName", aws_autoscaling_group.primary.name],
            [".", "GroupDesiredCapacity", "AutoScalingGroupName", aws_autoscaling_group.primary.name]
          ]
          period = 60; stat = "Average"; view = "timeSeries"; region = var.primary_region
        }
      },
      {
        type = "metric"; width = 12; height = 6
        properties = {
          title   = "ALB: Requests + 5xx Errors"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount",           "LoadBalancer", aws_lb.primary.arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", "LoadBalancer", aws_lb.primary.arn_suffix]
          ]
          period = 60; stat = "Sum"; view = "timeSeries"; region = var.primary_region
        }
      },
      {
        type = "metric"; width = 12; height = 6
        properties = {
          title   = "ALB Target Response Time P95/P99"
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.primary.arn_suffix, { stat = "p95", label = "P95" }],
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.primary.arn_suffix, { stat = "p99", label = "P99" }]
          ]
          period = 60; view = "timeSeries"; region = var.primary_region
        }
      },
      {
        type = "metric"; width = 12; height = 6
        properties = {
          title   = "RDS: CPU + Free Storage"
          metrics = [
            ["AWS/RDS", "CPUUtilization",  "DBInstanceIdentifier", aws_db_instance.primary.identifier],
            ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", aws_db_instance.primary.identifier]
          ]
          period = 60; stat = "Average"; view = "timeSeries"; region = var.primary_region
        }
      },
      {
        type = "metric"; width = 12; height = 6
        properties = {
          title   = "WAF: Blocked Requests"
          metrics = [["AWS/WAFV2", "BlockedRequests", "WebACL", aws_wafv2_web_acl.main.name, "Region", "CloudFront", "Rule", "ALL"]]
          period = 60; stat = "Sum"; view = "timeSeries"; region = "us-east-1"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  provider            = aws.primary
  alarm_name          = "${var.project_name}-asg-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "ASG average CPU > 80% for 2 minutes — investigate scaling"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions          = { AutoScalingGroupName = aws_autoscaling_group.primary.name }
  tags                = { Name = "${var.project_name}-cpu-alarm" }
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  provider            = aws.primary
  alarm_name          = "${var.project_name}-unhealthy-targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "ALB target unhealthy — requires investigation"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    LoadBalancer = aws_lb.primary.arn_suffix
    TargetGroup  = aws_lb_target_group.primary.arn_suffix
  }
  tags = { Name = "${var.project_name}-unhealthy-alarm" }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  provider            = aws.primary
  alarm_name          = "${var.project_name}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 75
  alarm_description   = "RDS CPU > 75% for 3 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions          = { DBInstanceIdentifier = aws_db_instance.primary.identifier }
  tags                = { Name = "${var.project_name}-rds-cpu-alarm" }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  provider            = aws.primary
  alarm_name          = "${var.project_name}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120  # 5 GB
  alarm_description   = "RDS free storage below 5 GB — consider scaling"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions          = { DBInstanceIdentifier = aws_db_instance.primary.identifier }
  tags                = { Name = "${var.project_name}-rds-storage-alarm" }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  provider            = aws.primary
  alarm_name          = "${var.project_name}-alb-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 50
  alarm_description   = "ALB 5xx errors > 50/min for 2 consecutive minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"
  dimensions          = { LoadBalancer = aws_lb.primary.arn_suffix }
  tags                = { Name = "${var.project_name}-5xx-alarm" }
}

###############################################################################
# GUARDDUTY — ACTIVE MONITORING (continuous threat detection)
###############################################################################

resource "aws_guardduty_detector" "primary" {
  provider = aws.primary
  enable   = true

  datasources {
    s3_logs { enable = true }
    kubernetes { audit_logs { enable = true } }
    malware_protection {
      scan_ec2_instance_with_findings { ebs_volumes { enable = true } }
    }
  }

  finding_publishing_frequency = "FIFTEEN_MINUTES"
  tags                         = { Name = "${var.project_name}-guardduty-primary" }
}

resource "aws_guardduty_detector" "dr" {
  provider                     = aws.dr
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"
  tags                         = { Name = "${var.project_name}-guardduty-dr" }
}

###############################################################################
# LAMBDA — ACTIVE MONITORING (automated threat response)
# Stops EC2 instances flagged HIGH/CRITICAL by GuardDuty, notifies via SNS
###############################################################################

resource "aws_iam_role" "lambda_threat" {
  provider = aws.primary
  name     = "${var.project_name}-lambda-threat-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "lambda.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_policy" "lambda_threat" {
  provider = aws.primary
  name     = "${var.project_name}-lambda-threat-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow"; Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]; Resource = "arn:aws:logs:*:*:*" },
      { Effect = "Allow"; Action = ["ec2:DescribeInstances", "ec2:StopInstances", "ec2:CreateTags"]; Resource = "*" },
      { Effect = "Allow"; Action = ["sns:Publish"]; Resource = [aws_sns_topic.alerts.arn] },
      { Effect = "Allow"; Action = ["guardduty:GetFindings"]; Resource = "*" }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_threat" {
  provider   = aws.primary
  role       = aws_iam_role.lambda_threat.name
  policy_arn = aws_iam_policy.lambda_threat.arn
}

data "archive_file" "threat_lambda" {
  type        = "zip"
  output_path = "/tmp/${var.project_name}-threat-lambda.zip"
  source {
    filename = "index.py"
    content  = <<-PYTHON
import json, boto3, os, logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    ec2    = boto3.client('ec2')
    sns    = boto3.client('sns')
    detail = event.get('detail', {})
    severity  = detail.get('severity', 0)
    finding_type = detail.get('type', 'unknown')

    logger.info(f"GuardDuty finding: severity={severity}, type={finding_type}")

    if severity < 7.0:
        logger.info("Below HIGH threshold (7.0) — monitoring only")
        return {'statusCode': 200, 'body': 'Below threshold — logged only'}

    instance_id = (detail
        .get('resource', {})
        .get('instanceDetails', {})
        .get('instanceId'))

    if instance_id:
        ec2.stop_instances(InstanceIds=[instance_id])
        ec2.create_tags(Resources=[instance_id], Tags=[
            {'Key': 'SecurityStatus', 'Value': 'QUARANTINED'},
            {'Key': 'QuarantineReason', 'Value': finding_type}
        ])
        msg = (f"ACTIVE THREAT RESPONSE\n"
               f"Instance {instance_id} STOPPED\n"
               f"Severity: {severity} | Finding: {finding_type}\n"
               f"Action: Instance quarantined — review CloudTrail for context")
        sns.publish(
            TopicArn=os.environ['SNS_TOPIC_ARN'],
            Subject=f"[AUTO-RESPONSE] GuardDuty HIGH Finding — {finding_type}",
            Message=msg
        )
        logger.info(f"Instance {instance_id} stopped and tagged as QUARANTINED")

    return {'statusCode': 200, 'body': f'Quarantined: {instance_id}'}
PYTHON
  }
}

resource "aws_lambda_function" "threat_response" {
  provider         = aws.primary
  function_name    = "${var.project_name}-threat-response"
  role             = aws_iam_role.lambda_threat.arn
  handler          = "index.handler"
  runtime          = "python3.12"
  timeout          = 60
  filename         = data.archive_file.threat_lambda.output_path
  source_code_hash = data.archive_file.threat_lambda.output_base64sha256

  environment {
    variables = {
      SNS_TOPIC_ARN = aws_sns_topic.alerts.arn
      PROJECT_NAME  = var.project_name
    }
  }

  tags = { Name = "${var.project_name}-threat-response" }
}

resource "aws_cloudwatch_log_group" "lambda_threat" {
  provider          = aws.primary
  name              = "/aws/lambda/${aws_lambda_function.threat_response.function_name}"
  retention_in_days = 30
  tags              = { Name = "${var.project_name}-lambda-logs" }
}

###############################################################################
# EVENTBRIDGE — WIRES GUARDDUTY FINDINGS → LAMBDA (active monitoring trigger)
###############################################################################

resource "aws_cloudwatch_event_rule" "guardduty_high" {
  provider    = aws.primary
  name        = "${var.project_name}-guardduty-high-findings"
  description = "Route HIGH/CRITICAL GuardDuty findings to auto-response Lambda"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
    detail      = { severity = [{ numeric = [">=", 7] }] }
  })

  tags = { Name = "${var.project_name}-guardduty-event-rule" }
}

resource "aws_cloudwatch_event_target" "lambda_threat" {
  provider  = aws.primary
  rule      = aws_cloudwatch_event_rule.guardduty_high.name
  target_id = "ThreatResponseLambda"
  arn       = aws_lambda_function.threat_response.arn
}

resource "aws_lambda_permission" "eventbridge_invoke" {
  provider      = aws.primary
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.threat_response.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.guardduty_high.arn
}

###############################################################################
# OUTPUTS
###############################################################################

output "primary_alb_dns"      { value = aws_lb.primary.dns_name }
output "dr_alb_dns"           { value = aws_lb.dr.dns_name }
output "cloudfront_domain"    { value = aws_cloudfront_distribution.main.domain_name }
output "app_url"              { value = "https://${aws_cloudfront_distribution.main.domain_name}" }
output "primary_vpc_id"       { value = aws_vpc.primary.id }
output "dr_vpc_id"            { value = aws_vpc.dr.id }
output "rds_primary_endpoint" { value = aws_db_instance.primary.endpoint }
output "rds_dr_endpoint"      { value = aws_db_instance.dr_replica.endpoint }
output "artifacts_bucket"     { value = aws_s3_bucket.artifacts_primary.bucket }
output "sns_alerts_arn"       { value = aws_sns_topic.alerts.arn }
output "cw_dashboard"         { value = "https://console.aws.amazon.com/cloudwatch/home?region=${var.primary_region}#dashboards:name=${var.project_name}-operations" }
output "waf_acl_id"           { value = aws_wafv2_web_acl.main.id }
