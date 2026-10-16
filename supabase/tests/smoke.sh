#!/usr/bin/env bash
# Migration smoke test: applies every migration in order to a throwaway PostGIS 17 container,
# runs assertions, applies the seed twice (idempotency), then tears down.
# Usage: bash supabase/tests/smoke.sh            (docker)
#        SMOKE_DB_URL=postgres://... bash supabase/tests/smoke.sh   (existing empty database; no docker)
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE="${SMOKE_PG_IMAGE:-postgis/postgis:17-3.5}"
CONTAINER="ajis-smoke-$$"
PORT="${SMOKE_PG_PORT:-55432}"
cleanup() { if [[ -z "${SMOKE_DB_URL:-}" ]]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

if [[ -z "${SMOKE_DB_URL:-}" ]]; then
  docker ps -a --filter "name=ajis-smoke" -q | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=postgres -p "127.0.0.1:${PORT}:5432" "$IMAGE" >/dev/null
  SMOKE_DB_URL="postgres://postgres:smoke@127.0.0.1:${PORT}/postgres"
  for i in $(seq 1 60); do
    if psql "$SMOKE_DB_URL" -c 'select 1' >/dev/null 2>&1; then break; fi
    sleep 1
    if [[ $i -eq 60 ]]; then echo "postgres did not start"; docker logs "$CONTAINER" | tail -20; exit 1; fi
  done
fi
export PGOPTIONS="-c client_min_messages=warning"

echo "== applying migrations"
for f in supabase/migrations/*.sql; do
  echo "   $f"
  psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "== assertions"
psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/smoke.sql
echo "== seed (twice, must be idempotent)"
psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/smoke_seed.sql
# Optional extra seed files (researched employers). Applied twice to prove idempotency.
EXTRA_SEEDS="${SMOKE_EXTRA_SEEDS:-$(ls supabase/seed/*.sql 2>/dev/null || true)}"
for f in $EXTRA_SEEDS; do
  echo "== extra seed (twice): $f"
  psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  psql "$SMOKE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  psql "$SMOKE_DB_URL" -At -c "select 'employers=' || count(*) || ' offices=' || (select count(*) from public.offices) || ' tasks=' || (select count(*) from public.tasks) || ' dup_domains=' || (select count(*) from (select website_domain from public.employers where website_domain is not null group by 1 having count(*) > 1) d) from public.employers"
done
echo "== OK"
