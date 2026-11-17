resource "random_password" "admin_token" {
  length  = 40
  special = false
}

# Connection strings are assembled here so tasks only ever see a Secrets Manager reference.
resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    # uselibpqcompat+require = TLS without CA pinning inside the VPC (see docs/SECURITY.md, pending: verify-full with the RDS CA bundle)
    DATABASE_URL = "postgres://${aws_db_instance.postgres.username}:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/hookrelay?sslmode=require&uselibpqcompat=true"
    REDIS_URL    = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
    ADMIN_TOKEN  = random_password.admin_token.result
  })
}

# Dashboard BFF key: created after the first deploy (POST /v1/apps) and written here by an operator.
resource "aws_secretsmanager_secret" "web_api_key" {
  name                    = "${local.name}/web-api-key"
  recovery_window_in_days = 7
}
