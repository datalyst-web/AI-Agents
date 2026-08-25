output "chat_api_ecr_repository_url" {
  value = aws_ecr_repository.chat_api.repository_url
}

output "chat_workers_ecr_repository_url" {
  value = aws_ecr_repository.chat_workers.repository_url
}

output "chat_dashboard_ecr_repository_url" {
  value = aws_ecr_repository.chat_dashboard.repository_url
}

output "chat_dashboard_url" {
  value = "https://${var.chat_dashboard_domain}"
}

output "chat_api_url" {
  value = "https://${var.chat_api_domain}"
}

output "widget_script_url" {
  value = "https://${var.widget_cdn_domain}/widget.js"
}

output "knowledge_ingest_queue_url" {
  value = aws_sqs_queue.chat_knowledge_ingest.url
}

output "workflow_run_queue_url" {
  value = aws_sqs_queue.chat_workflow_run.url
}

output "followup_queue_url" {
  value = aws_sqs_queue.chat_followup.url
}
