variable "aws_region" {
  description = "AWS region of the shared agents-platform infrastructure."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (prod, staging, dev)."
  type        = string
}

variable "platform_tag_value" {
  description = "Value of the 'Project' tag on the shared platform resources this looks up via data sources."
  type        = string
  default     = "agents-platform"
}

variable "chat_api_image_tag" {
  description = "Docker image tag to deploy for chat-api (set by CI, see .github/workflows/deploy-api.yml)."
  type        = string
  default     = "latest"
}

variable "chat_workers_image_tag" {
  description = "Docker image tag to deploy for chat-workers."
  type        = string
  default     = "latest"
}

variable "chat_api_desired_count" {
  type    = number
  default = 2
}

variable "chat_api_cpu" {
  type    = number
  default = 512
}

variable "chat_api_memory" {
  type    = number
  default = 1024
}

variable "chat_workers_desired_count" {
  type    = number
  default = 2
}

variable "chat_workers_cpu" {
  type    = number
  default = 512
}

variable "chat_workers_memory" {
  type    = number
  default = 1024
}

variable "chat_dashboard_image_tag" {
  type    = string
  default = "latest"
}

variable "chat_dashboard_desired_count" {
  type    = number
  default = 2
}

variable "chat_dashboard_cpu" {
  type    = number
  default = 256
}

variable "chat_dashboard_memory" {
  type    = number
  default = 512
}

variable "chat_dashboard_domain" {
  description = "Public hostname routed to chat-dashboard on the shared ALB, e.g. app.agents-platform.example.com."
  type        = string
}

variable "chat_api_domain" {
  description = "Public hostname routed to chat-api on the shared ALB, e.g. chat-api.agents-platform.example.com."
  type        = string
}

variable "widget_cdn_domain" {
  description = "Public hostname for the widget CDN, e.g. widget.agents-platform.example.com."
  type        = string
}

variable "route53_zone_id" {
  description = "Existing shared Route53 hosted zone ID to add DNS records into."
  type        = string
}
