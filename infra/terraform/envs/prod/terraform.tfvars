# Copy this file to terraform.tfvars and fill in the values.
# NEVER commit terraform.tfvars — it contains sensitive account info.

aws_region     = "ap-northeast-2"
project        = "aigo"
aws_account_id = "440744256869"       # Your AWS account ID
github_org     = "hj-3"   # GitHub organization name
alert_email    = "hyjoon333@gmail.com"
domain_name    = "seolphung.com"  # Leave "" to use AWS default domains

enable_nat_gateway = true
