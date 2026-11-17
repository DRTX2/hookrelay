output "url" {
  value = "${local.https ? "https" : "http"}://${aws_lb.this.dns_name}"
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "github_ecr_role_arn" {
  value       = aws_iam_role.github_ecr.arn
  description = "Set as the AWS_ECR_ROLE_ARN repository variable."
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as the AWS_DEPLOY_ROLE_ARN repository variable."
}

output "web_api_key_secret" {
  value = aws_secretsmanager_secret.web_api_key.name
}
