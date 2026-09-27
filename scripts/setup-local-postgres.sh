#!/usr/bin/env bash
set -Eeuo pipefail

# Starts/reuses an isolated local PostgreSQL 16 container for CellFlow.
# It does not modify .env.local; generate that first with scripts/generate-env.sh.

CONTAINER="${CELLFLOW_PG_CONTAINER:-cellflow-postgres}"
PORT="${CELLFLOW_PG_PORT:-54329}"
USER="${CELLFLOW_PG_USER:-cellflow}"
PASSWORD="${CELLFLOW_PG_PASSWORD:-cellflow_local_only}"
DB="${CELLFLOW_PG_DB:-cellflow}"

command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker is required, or set DATABASE_URL to an existing PostgreSQL instance." >&2; exit 1; }

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_USER="$USER" \
    -e POSTGRES_PASSWORD="$PASSWORD" \
    -e POSTGRES_DB="$DB" \
    -p "$PORT:5432" postgres:16-alpine >/dev/null
elif [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]]; then
  docker start "$CONTAINER" >/dev/null
fi

echo "Waiting for PostgreSQL container $CONTAINER ..."
for _ in $(seq 1 45); do
  if docker exec "$CONTAINER" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
    echo "PostgreSQL ready: postgresql://$USER:***@127.0.0.1:$PORT/$DB"
    exit 0
  fi
  sleep 1
done

echo "ERROR: PostgreSQL did not become ready" >&2
exit 1
