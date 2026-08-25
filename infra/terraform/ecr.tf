resource "aws_ecr_repository" "chat_api" {
  name                 = "chat-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "chat_workers" {
  name                 = "chat-workers"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "chat_dashboard" {
  name                 = "chat-dashboard"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "expire_untagged" {
  for_each = {
    api       = aws_ecr_repository.chat_api.name
    workers   = aws_ecr_repository.chat_workers.name
    dashboard = aws_ecr_repository.chat_dashboard.name
  }
  repository = each.value

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}
