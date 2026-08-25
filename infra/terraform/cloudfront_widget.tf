# The widget bundle is the one piece of this product that's genuinely
# public (a script tag on client websites), unlike the tenant-data bucket
# looked up in data.tf — so it gets its own small, purpose-built bucket +
# CDN rather than a public prefix carved out of the shared private bucket.

resource "aws_s3_bucket" "widget_assets" {
  bucket = "agents-platform-chat-widget-assets"
}

resource "aws_s3_bucket_public_access_block" "widget_assets" {
  bucket                  = aws_s3_bucket.widget_assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "widget" {
  name                              = "chat-widget-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "widget" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "widget.js"
  aliases             = [var.widget_cdn_domain]
  comment             = "chat-agent widget CDN"

  origin {
    domain_name              = aws_s3_bucket.widget_assets.bucket_regional_domain_name
    origin_id                = "widget-s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.widget.id
  }

  default_cache_behavior {
    target_origin_id       = "widget-s3-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods          = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # Widget updates should propagate fast — short TTL, cache-busted by
    # apps/widget's build hash in a follow-up (kept simple here).
    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 3600
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.platform_wildcard.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_acm_certificate" "platform_wildcard" {
  domain      = "*.agents-platform.example.com" # replace with the real shared platform wildcard domain
  statuses    = ["ISSUED"]
  most_recent = true
}

data "aws_iam_policy_document" "widget_bucket_policy" {
  statement {
    sid       = "AllowCloudFrontOAC"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.widget_assets.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.widget.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "widget_assets" {
  bucket = aws_s3_bucket.widget_assets.id
  policy = data.aws_iam_policy_document.widget_bucket_policy.json
}

resource "aws_route53_record" "widget_cdn" {
  zone_id = data.aws_route53_zone.platform.zone_id
  name    = var.widget_cdn_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.widget.domain_name
    zone_id                = aws_cloudfront_distribution.widget.hosted_zone_id
    evaluate_target_health = false
  }
}
