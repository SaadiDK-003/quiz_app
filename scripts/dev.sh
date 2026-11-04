#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ! -f "$repo_dir/apps/api/.env" ]]; then
  printf '%s\n' 'Set up apps/api/.env and run the migrations first. See README.md.' >&2
  exit 1
fi
cd "$repo_dir/apps/api"
php artisan serve --host=127.0.0.1 --port=8000 &
api_pid=$!
cd "$repo_dir/apps/web"
node "$repo_dir/node_modules/next/dist/bin/next" dev --hostname 127.0.0.1 &
web_pid=$!
cleanup() { kill "$api_pid" "$web_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait -n "$api_pid" "$web_pid"
