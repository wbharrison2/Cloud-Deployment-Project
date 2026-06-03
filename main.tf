###############################################################################
# PROJECT 1 — CLOUD INFRASTRUCTURE & DEVELOPMENT
# Author : Wilton B. Harrison
# Purpose: Provision a production-grade 3-tier AWS VPC with public/private
#          subnets, EC2 web server, S3 artifact bucket, security groups,
#          and IAM roles using Terraform IaC.
# Tools  : Terraform >= 1.6, AWS Provider >= 5.0 (open-source / free tier)
###############################################################################

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — swap bucket/key for your environment
  backend "s3" {
    bucket         = "wbh-terraform-state"
    key            = "project1/cloud-infra/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "wbh-tf-lock"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "Cloud-Infra-Dev"
      Owner       = "Wilton B. Harrison"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

###############################################################################
# VARIABLES
###############################################################################

variable "aws_region"   { default = "us-east-1" }
variable "environment"  { default = "dev" }
variable "project_name" { default = "wbh-cloud-infra" }
variable "vpc_cidr"     { default = "10.0.0.0/16" }

variable "public_subnets" {
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}
variable "private_subnets" {
  default = ["10.0.10.0/24", "10.0.11.0/24"]
}
variable "data_subnets" {
  default = ["10.0.20.0/24", "10.0.21.0/24"]
}

variable "ami_id"        { default = "ami-0c02fb55956c7d316" } # Amazon Linux 2
variable "instance_type" { default = "t3.micro" }
variable "key_pair_name" { default = "wbh-dev-key" }

###############################################################################
# DATA SOURCES
###############################################################################

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

###############################################################################
# VPC
###############################################################################

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project_name}-vpc" }
}

# Internet Gateway (public egress)
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}

###############################################################################
# SUBNETS — 3-TIER ARCHITECTURE
###############################################################################

# Tier 1: Public (web / load balancer)
resource "aws_subnet" "public" {
  count                   = length(var.public_subnets)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnets[count.index]
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project_name}-public-${count.index + 1}", Tier = "Public" }
}

# Tier 2: Private (application)
resource "aws_subnet" "private" {
  count             = length(var.private_subnets)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnets[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project_name}-private-${count.index + 1}", Tier = "App" }
}

# Tier 3: Data (databases / storage)
resource "aws_subnet" "data" {
  count             = length(var.data_subnets)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.data_subnets[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project_name}-data-${count.index + 1}", Tier = "Data" }
}

###############################################################################
# NAT GATEWAY (private tier egress)
###############################################################################

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-nat-eip" }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.project_name}-nat" }
  depends_on    = [aws_internet_gateway.igw]
}

###############################################################################
# ROUTE TABLES
###############################################################################

# Public — route to IGW
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = { Name = "${var.project_name}-rt-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private — route to NAT
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }
  tags = { Name = "${var.project_name}-rt-private" }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

###############################################################################
# SECURITY GROUPS
###############################################################################

# Web tier — allow HTTP/HTTPS from internet
resource "aws_security_group" "web" {
  name        = "${var.project_name}-sg-web"
  description = "Web tier: allow HTTP/HTTPS inbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project_name}-sg-web" }
}

# App tier — allow traffic only from web SG
resource "aws_security_group" "app" {
  name        = "${var.project_name}-sg-app"
  description = "App tier: allow inbound from web tier only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from web tier"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project_name}-sg-app" }
}

# Data tier — allow only from app SG on port 5432 (PostgreSQL)
resource "aws_security_group" "data" {
  name        = "${var.project_name}-sg-data"
  description = "Data tier: allow inbound from app tier only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from app tier"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  tags = { Name = "${var.project_name}-sg-data" }
}

###############################################################################
# EC2 — WEB SERVER (Public Tier)
###############################################################################

resource "aws_iam_role" "ec2_role" {
  name = "${var.project_name}-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2_role.name
}

resource "aws_instance" "web" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  key_name               = var.key_pair_name

  user_data = <<-EOF
    #!/bin/bash
    yum update -y
    yum install -y httpd
    systemctl start httpd
    systemctl enable httpd
    echo "<h1>Project 1 — Cloud Infrastructure Online | WBH</h1>" > /var/www/html/index.html
  EOF

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = "${var.project_name}-web-server" }
}

###############################################################################
# S3 — ARTIFACT / DEPLOYMENT BUCKET
###############################################################################

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.project_name}-artifacts-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
  tags          = { Name = "${var.project_name}-artifacts" }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

###############################################################################
# OUTPUTS
###############################################################################

output "vpc_id"          { value = aws_vpc.main.id }
output "web_instance_ip" { value = aws_instance.web.public_ip }
output "s3_bucket_name"  { value = aws_s3_bucket.artifacts.bucket }
output "web_url"         { value = "http://${aws_instance.web.public_ip}" }
