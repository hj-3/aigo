output "guardduty_detector_id" {
  description = "GuardDuty detector ID"
  value       = aws_guardduty_detector.main.id
}

output "waf_web_acl_arn" {
  description = "WAF Web ACL ARN (REGIONAL — for API Gateway)"
  value       = aws_wafv2_web_acl.api.arn
}

output "waf_web_acl_id" {
  description = "WAF Web ACL ID"
  value       = aws_wafv2_web_acl.api.id
}

output "cloudtrail_arn" {
  description = "CloudTrail trail ARN"
  value       = aws_cloudtrail.main.arn
}
