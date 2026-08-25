# Every resource in this file is a LOOKUP against the already-provisioned
# shared platform (see ../README.md) — nothing here creates infrastructure.
# If any of these lookups fail, the shared platform hasn't been stood up
# yet in this account/region; that's provisioned once from the platform's
# own IaC (originally the Voice Agent repo's Terraform), not from here.

data "aws_vpc" "platform" {
  tags = {
    Project = var.platform_tag_value
  }
}

data "aws_subnets" "platform_private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.platform.id]
  }
  tags = {
    Project = var.platform_tag_value
    Tier    = "private"
  }
}

data "aws_ecs_cluster" "platform" {
  cluster_name = "agents-platform"
}

data "aws_lb" "platform" {
  tags = {
    Project = var.platform_tag_value
  }
}

data "aws_lb_listener" "platform_https" {
  load_balancer_arn = data.aws_lb.platform.arn
  port               = 443
}

data "aws_rds_cluster" "platform_aurora" {
  cluster_identifier = "agents-platform-aurora"
}

data "aws_elasticache_replication_group" "platform_redis" {
  replication_group_id = "agents-platform-redis"
}

data "aws_s3_bucket" "platform_storage" {
  bucket = "agents-platform-storage"
}

data "aws_security_group" "platform_internal" {
  tags = {
    Project = var.platform_tag_value
    Purpose = "internal-service-to-service"
  }
}

data "aws_iam_role" "ecs_task_execution" {
  name = "agents-platform-ecs-task-execution"
}

data "aws_route53_zone" "platform" {
  zone_id = var.route53_zone_id
}
