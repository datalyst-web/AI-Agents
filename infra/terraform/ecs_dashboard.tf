resource "aws_cloudwatch_log_group" "chat_dashboard" {
  name              = "/agents-platform/chat-dashboard"
  retention_in_days = 30
}

resource "aws_iam_role" "chat_dashboard_task" {
  name               = "chat-dashboard-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

# Dashboard is a Next.js frontend with no direct DB/secrets/queue access
# (CLAUDE.md: "Talks only to apps/api") — it deliberately gets no policy
# attachment from aws_iam_policy.chat_scoped_access.

resource "aws_ecs_task_definition" "chat_dashboard" {
  family                   = "chat-dashboard"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.chat_dashboard_cpu
  memory                   = var.chat_dashboard_memory
  execution_role_arn       = data.aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.chat_dashboard_task.arn

  container_definitions = jsonencode([
    {
      name         = "chat-dashboard"
      image        = "${aws_ecr_repository.chat_dashboard.repository_url}:${var.chat_dashboard_image_tag}"
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.chat_dashboard.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "chat-dashboard"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "chat_dashboard" {
  name            = "chat-dashboard"
  cluster         = data.aws_ecs_cluster.platform.arn
  task_definition = aws_ecs_task_definition.chat_dashboard.arn
  desired_count   = var.chat_dashboard_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.platform_private.ids
    security_groups  = [data.aws_security_group.platform_internal.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.chat_dashboard.arn
    container_name    = "chat-dashboard"
    container_port    = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_lb_target_group" "chat_dashboard" {
  name        = "chat-dashboard-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.platform.id
  target_type = "ip"

  health_check {
    path                = "/login"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }
}

resource "aws_lb_listener_rule" "chat_dashboard" {
  listener_arn = data.aws_lb_listener.platform_https.arn
  priority     = 101

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.chat_dashboard.arn
  }

  condition {
    host_header {
      values = [var.chat_dashboard_domain]
    }
  }
}

resource "aws_route53_record" "chat_dashboard" {
  zone_id = data.aws_route53_zone.platform.zone_id
  name    = var.chat_dashboard_domain
  type    = "A"

  alias {
    name                   = data.aws_lb.platform.dns_name
    zone_id                = data.aws_lb.platform.zone_id
    evaluate_target_health = true
  }
}
