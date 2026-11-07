output "bucket_name" {
  value = aws_s3_bucket.images.bucket
}

output "app_url" {
  description = "REST API URL from the host running Docker."
  value       = "http://127.0.0.1:4566/restapis/${aws_api_gateway_rest_api.gallery.id}/${aws_api_gateway_stage.gallery.stage_name}/_user_request_/"
}
