# New queues on the shared platform's SQS account — no separate SQS setup
# per product (ARCHITECTURE.md: "One SQS account setup ... per-product
# queues"). A dead-letter queue per queue so a poison message can't loop
# forever silently, matching CLAUDE.md's "must not silently drop" rule
# applied at the transport layer.

resource "aws_sqs_queue" "chat_knowledge_ingest_dlq" {
  name                      = "chat-knowledge-ingest-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "chat_knowledge_ingest" {
  name                       = "chat-knowledge-ingest"
  visibility_timeout_seconds = 300 # document extraction/embedding can take a while
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.chat_knowledge_ingest_dlq.arn
    maxReceiveCount      = 5
  })
}

resource "aws_sqs_queue" "chat_workflow_run_dlq" {
  name                      = "chat-workflow-run-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "chat_workflow_run" {
  name                       = "chat-workflow-run"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.chat_workflow_run_dlq.arn
    maxReceiveCount      = 5
  })
}

resource "aws_sqs_queue" "chat_followup_dlq" {
  name                      = "chat-followup-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "chat_followup" {
  name                       = "chat-followup"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.chat_followup_dlq.arn
    maxReceiveCount      = 5
  })
}
