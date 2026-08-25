# Task roles scoped ONLY to chat/* — the whole point of sharing the
# platform's Secrets Manager/S3 bucket is cost, not blanket access. Neither
# role can read Voice's or Sales' secrets or object-storage prefixes.

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "chat_api_task" {
  name               = "chat-api-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role" "chat_workers_task" {
  name               = "chat-workers-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

data "aws_iam_policy_document" "chat_scoped_access" {
  statement {
    sid     = "SecretsManagerChatPrefixOnly"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue", "secretsmanager:CreateSecret"]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:*:secret:chat/*"]
  }

  statement {
    sid     = "S3ChatPrefixOnly"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${data.aws_s3_bucket.platform_storage.arn}/chat/*"]
  }

  statement {
    sid       = "S3ListChatPrefixOnly"
    actions   = ["s3:ListBucket"]
    resources = [data.aws_s3_bucket.platform_storage.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["chat/*"]
    }
  }

  statement {
    sid     = "SqsChatQueuesOnly"
    actions = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [
      aws_sqs_queue.chat_knowledge_ingest.arn,
      aws_sqs_queue.chat_workflow_run.arn,
      aws_sqs_queue.chat_followup.arn,
    ]
  }

  statement {
    sid       = "RdsIamAuthConnectAsChatAppUser"
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${var.aws_region}:*:dbuser:${data.aws_rds_cluster.platform_aurora.cluster_resource_id}/chat_app_user"]
  }
}

resource "aws_iam_policy" "chat_scoped_access" {
  name   = "chat-agent-scoped-platform-access"
  policy = data.aws_iam_policy_document.chat_scoped_access.json
}

resource "aws_iam_role_policy_attachment" "chat_api_scoped" {
  role       = aws_iam_role.chat_api_task.name
  policy_arn = aws_iam_policy.chat_scoped_access.arn
}

resource "aws_iam_role_policy_attachment" "chat_workers_scoped" {
  role       = aws_iam_role.chat_workers_task.name
  policy_arn = aws_iam_policy.chat_scoped_access.arn
}
