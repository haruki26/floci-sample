locals {
  function_name = "image-gallery"
  bucket_name   = "floci-image-gallery"
}

resource "aws_s3_bucket" "images" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role" "lambda" {
  name = "${local.function_name}-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "images" {
  name = "${local.function_name}-images"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = aws_s3_bucket.images.arn
      }, {
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = "${aws_s3_bucket.images.arn}/*"
    }]
  })
}

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.root}/../dist/index.js"
  output_path = "${path.root}/function.zip"
}

resource "aws_lambda_function" "gallery" {
  function_name    = local.function_name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      BUCKET_NAME               = aws_s3_bucket.images.bucket
      S3_ENDPOINT               = "http://floci:4566"
      AWS_REGION                = "us-east-1"
      AWS_ACCESS_KEY_ID         = "test"
      AWS_SECRET_ACCESS_KEY     = "test"
      AWS_EC2_METADATA_DISABLED = "true"
      BASE_PATH                 = "/restapis/${aws_api_gateway_rest_api.gallery.id}/local/_user_request_"
    }
  }

  depends_on = [aws_iam_role_policy.images]
}

resource "aws_api_gateway_rest_api" "gallery" {
  name               = "${local.function_name}-api"
  binary_media_types = ["*/*"]
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.gallery.id
  parent_id   = aws_api_gateway_rest_api.gallery.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "root" {
  rest_api_id   = aws_api_gateway_rest_api.gallery.id
  resource_id   = aws_api_gateway_rest_api.gallery.root_resource_id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id   = aws_api_gateway_rest_api.gallery.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "root" {
  rest_api_id             = aws_api_gateway_rest_api.gallery.id
  resource_id             = aws_api_gateway_rest_api.gallery.root_resource_id
  http_method             = aws_api_gateway_method.root.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/${aws_lambda_function.gallery.arn}/invocations"
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id             = aws_api_gateway_rest_api.gallery.id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.proxy.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/${aws_lambda_function.gallery.arn}/invocations"
}

resource "aws_api_gateway_deployment" "gallery" {
  rest_api_id = aws_api_gateway_rest_api.gallery.id
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_method.root.id,
      aws_api_gateway_method.proxy.id,
      aws_api_gateway_integration.root.id,
      aws_api_gateway_integration.proxy.id,
      aws_api_gateway_rest_api.gallery.binary_media_types,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.root,
    aws_api_gateway_integration.proxy,
  ]
}

resource "aws_api_gateway_stage" "gallery" {
  deployment_id = aws_api_gateway_deployment.gallery.id
  rest_api_id   = aws_api_gateway_rest_api.gallery.id
  stage_name    = "local"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gallery.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.gallery.execution_arn}/*/*"
}
