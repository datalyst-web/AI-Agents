resource "aws_cloudwatch_log_group" "chat_workers" {
  name              = "/agents-platform/chat-workers"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "chat_workers" {
  family                   = "chat-workers"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.chat_workers_cpu
  memory                   = var.chat_workers_memory
  execution_role_arn       = data.aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.chat_workers_task.arn

  container_definitions = jsonencode([
    {
      name      = "chat-workers"
      image     = "${aws_ecr_repository.chat_workers.repository_url}:${var.chat_workers_image_tag}"
      essential = true
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
        { name = "WORKERS_CONCURRENCY", value = "4" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.chat_workers.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "chat-workers"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "chat_workers" {
  name            = "chat-workers"
  cluster         = data.aws_ecs_cluster.platform.arn
  task_definition = aws_ecs_task_definition.chat_workers.arn
  desired_count   = var.chat_workers_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.platform_private.ids
    security_groups  = [data.aws_security_group.platform_internal.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_appautoscaling_target" "chat_workers" {
  max_capacity       = var.chat_workers_desired_count * 6
  min_capacity       = var.chat_workers_desired_count
  resource_id        = "service/${data.aws_ecs_cluster.platform.cluster_name}/${aws_ecs_service.chat_workers.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale on queue depth rather than CPU — a knowledge-ingest burst (a client
# uploading a large PDF set) is I/O/embedding-bound, not CPU-bound.
resource "aws_appautoscaling_policy" "chat_workers_queue_depth" {
  name               = "chat-workers-queue-depth-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.chat_workers.resource_id
  scalable_dimension = aws_appautoscaling_target.chat_workers.scalable_dimension
  service_namespace  = aws_appautoscaling_target.chat_workers.service_namespace

  target_tracking_scaling_policy_configuration {
    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
      dimensions {
        name  = "QueueName"
        value = aws_sqs_queue.chat_knowledge_ingest.name
      }
    }
    target_value = 10
  }
}
