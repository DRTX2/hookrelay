resource "aws_ecs_cluster" "this" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "web"])
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = 30
}

locals {
  api_image = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
  web_image = "${aws_ecr_repository.app["web"].repository_url}:${var.image_tag}"

  app_secrets = concat([for k in ["DATABASE_URL", "REDIS_URL", "ADMIN_TOKEN"] : {
    name      = k
    valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::"
    }], var.integration_secret_arn == "" ? [] : [{ # verifies Nimbus' signed inbound incidents
    name      = "NIMBUS_WEBHOOK_SECRET"
    valueFrom = "${var.integration_secret_arn}:NIMBUS_WEBHOOK_SECRET::"
  }])
  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_FORMAT", value = "json" },
    { name = "RETRY_SCHEDULE", value = var.retry_schedule },
  ]
  logs = { for k, g in aws_cloudwatch_log_group.app : k => {
    logDriver = "awslogs"
    options   = { awslogs-group = g.name, awslogs-region = var.region, awslogs-stream-prefix = k }
  } }

  services = {
    api = {
      cpu = 512, memory = 1024, desired = var.api_desired, image = local.api_image
      container = {
        command      = ["node", "dist/main.js"]
        portMappings = [{ containerPort = 3000 }]
        environment  = concat(local.common_env, [{ name = "PORT", value = "3000" }])
        secrets      = local.app_secrets
      }
      target_group = aws_lb_target_group.api.arn
    }
    worker = {
      cpu = 512, memory = 1024, desired = var.worker_desired, image = local.api_image
      container = {
        command     = ["node", "dist/worker.js"]
        environment = concat(local.common_env, [{ name = "WORKER_CONCURRENCY", value = "50" }])
        secrets     = local.app_secrets
        stopTimeout = 30 # finish in-flight deliveries (15s HTTP timeout) before SIGKILL
      }
      target_group = null
    }
    web = {
      cpu = 256, memory = 512, desired = 1, image = local.web_image
      container = {
        portMappings = [{ containerPort = 3000 }]
        environment  = [{ name = "HOOKRELAY_API_URL", value = "http://${aws_lb.this.dns_name}" }]
        secrets      = [{ name = "HOOKRELAY_API_KEY", valueFrom = aws_secretsmanager_secret.web_api_key.arn }]
      }
      target_group = aws_lb_target_group.web.arn
    }
  }
}

resource "aws_ecs_task_definition" "app" {
  for_each                 = local.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([merge(each.value.container, {
    name                   = each.key
    image                  = each.value.image
    essential              = true
    readonlyRootFilesystem = false
    logConfiguration       = local.logs[each.key]
  })])
}

resource "aws_ecs_service" "app" {
  for_each        = local.services
  name            = "${local.name}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.app[each.key].arn
  desired_count   = each.value.desired
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.app.id]
  }

  dynamic "load_balancer" {
    for_each = each.value.target_group == null ? [] : [each.value.target_group]
    content {
      target_group_arn = load_balancer.value
      container_name   = each.key
      container_port   = 3000
    }
  }

  # Failed rollout (crash loop / failing health checks) => automatic rollback to the previous task definition.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [desired_count] # owned by autoscaling after the first apply
  }
}

# --- Autoscaling ------------------------------------------------------------------------
resource "aws_appautoscaling_target" "app" {
  for_each           = { api = 6, worker = var.worker_max }
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.app[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = local.services[each.key].desired
  max_capacity       = each.value
}

# CPU tracking for both; workers are I/O bound, so queue depth is the better signal (docs/SCALABILITY.md, pending).
resource "aws_appautoscaling_policy" "cpu" {
  for_each           = aws_appautoscaling_target.app
  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = each.value.service_namespace
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 30
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
