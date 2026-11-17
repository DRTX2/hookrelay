environment     = "production"
region          = "us-east-1"
db_multi_az     = true
api_desired     = 2
worker_desired  = 2
worker_max      = 10
certificate_arn = "" # set your ACM certificate ARN to enable HTTPS
alarm_email     = "" # set to receive CloudWatch alarm notifications
