resource "aws_cloudwatch_log_group" "chat_api" {
  name              = "/agents-platform/chat-api"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "chat_api" {
  family                   = "chat-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.chat_api_cpu
  memory                   = var.chat_api_memory
  execution_role_arn       = data.aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.chat_api_task.arn

  container_definitions = jsonencode([
    {
      name      = "chat-api"
      image     = "${aws_ecr_repository.chat_api.repository_url}:${var.chat_api_image_tag}"
      essential = true
      portMappings = [{ containerPort = 4000, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = var.environment == "prod" ? "production" : var.environment },
        { name = "SECRETS_PROVIDER", value = "aws" },
        { name = "SECRETS_PATH_PREFIX", value = "chat/" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = data.aws_s3_bucket.platform_storage.bucket },
        { name = "S3_KEY_PREFIX", value = "chat" },
        { name = "REDIS_URL", value = "rediss://${data.aws_elasticache_replication_group.platform_redis.primary_endpoint_address}:6379" },
        { name = "REDIS_KEY_PREFIX", value = "chat:" },
        { name = "SQS_KNOWLEDGE_INGEST_QUEUE_URL", value = aws_sqs_queue.chat_knowledge_ingest.url },
        { name = "SQS_WORKFLOW_RUN_QUEUE_URL", value = aws_sqs_queue.chat_workflow_run.url },
        { name = "SQS_FOLLOWUP_QUEUE_URL", value = aws_sqs_queue.chat_followup.url },
        { name = "DATABASE_URL", value = "postgresql://chat_app_user@${data.aws_rds_cluster.platform_aurora.endpoint}:5432/agents_platform?schema=chat&sslmode=require" },
        { name = "API_PORT", value = "4000" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.chat_api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "chat-api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:4000/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
    }
  ])
}

resource "aws_ecs_service" "chat_api" {
  name            = "chat-api"
  cluster         = data.aws_ecs_cluster.platform.arn
  task_definition = aws_ecs_task_definition.chat_api.arn
  desired_count   = var.chat_api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.platform_private.ids
    security_groups  = [data.aws_security_group.platform_internal.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.chat_api.arn
    container_name    = "chat-api"
    container_port    = 4000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_lb_target_group" "chat_api" {
  name        = "chat-api-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.platform.id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }
}

resource "aws_lb_listener_rule" "chat_api" {
  listener_arn = data.aws_lb_listener.platform_https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.chat_api.arn
  }

  condition {
    host_header {
      values = [var.chat_api_domain]
    }
  }
}

resource "aws_route53_record" "chat_api" {
  zone_id = data.aws_route53_zone.platform.zone_id
  name    = var.chat_api_domain
  type    = "A"

  alias {
    name                   = data.aws_lb.platform.dns_name
    zone_id                = data.aws_lb.platform.zone_id
    evaluate_target_health = true
  }
}

resource "aws_appautoscaling_target" "chat_api" {
  max_capacity       = var.chat_api_desired_count * 4
  min_capacity       = var.chat_api_desired_count
  resource_id        = "service/${data.aws_ecs_cluster.platform.cluster_name}/${aws_ecs_service.chat_api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "chat_api_cpu" {
  name               = "chat-api-cpu-target-tracking"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.chat_api.resource_id
  scalable_dimension = aws_appautoscaling_target.chat_api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.chat_api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 60
  }
}
