#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

ENV_FILE="${1:-$PROJECT_DIR/.env}"
EXAMPLE_FILE="$PROJECT_DIR/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

# .env を source して環境変数にロード (信頼できるファイルのみ使用すること)
set -a
source "$ENV_FILE"
set +a

# .env.example からキー名を抽出し、環境変数経由で値を取得
count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"

  value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "Skip: $key (empty)"
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] $key = ${value:0:4}..."
  else
    echo "Setting $key ..."
    printf '%s' "$value" | bunx wrangler secret put "$key"
  fi
  ((count++))
done < "$EXAMPLE_FILE"

if [[ "$DRY_RUN" == true ]]; then
  echo "Done: $count secrets found."
else
  echo "Done: $count secrets uploaded."
fi
