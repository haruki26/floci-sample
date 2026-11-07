#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
npm ci
npm run build
docker compose up -d floci

attempt=0
until curl --silent http://127.0.0.1:4566/ >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Floci did not become ready at http://127.0.0.1:4566" >&2
    exit 1
  fi
  sleep 1
done

docker compose --profile tools run --rm terraform init
docker compose --profile tools run --rm terraform apply -auto-approve
docker compose --profile tools run --rm terraform output -raw app_url
printf '\n'
