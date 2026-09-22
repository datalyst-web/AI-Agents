#!/usr/bin/env bash
# Daily production database backup, run by .github/workflows/db-backup.yml
# under `railway run --service api`, which injects DATABASE_MIGRATE_URL (the
# owner connection) and the R2 credentials the app already uses for files.
#
#   1. pg_dump the whole database (custom format: schema, data, extensions,
#      RLS policies and grants).
#   2. Prove it restores: load it into the throwaway Postgres 18 container at
#      RESTORE_CHECK_URL and compare row counts of the core tables. A backup
#      that can't be restored is worse than none, because it looks like one.
#   3. Upload to R2 under backups/postgres/ — outside the per-tenant "chat/"
#      prefix, so deleting a client can never touch a backup.
#   4. Delete backups older than RETENTION_DAYS (the newest is always kept).
#
# Prints no credentials. Any failed step fails the job, which GitHub emails
# to the repository owner.
set -euo pipefail

: "${DATABASE_MIGRATE_URL:?}" "${RESTORE_CHECK_URL:?}" "${S3_BUCKET:?}" "${S3_ENDPOINT:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
export AWS_DEFAULT_REGION=auto
PREFIX="backups/postgres"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$(mktemp -d)/db-${stamp}.dump"

# Prisma-only parameters (schema=, connect_timeout is fine) are not libpq's.
src="$(printf '%s' "$DATABASE_MIGRATE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

echo "--- dumping (server $(psql "$src" -Atc 'SHOW server_version' | cut -d' ' -f1))"
pg_dump "$src" --format=custom --compress=9 --no-owner --file="$file"
echo "dump size: $(du -h "$file" | cut -f1)"

TABLES="tenants users agents knowledge_sources documents chunks conversations messages audit_log_entries"
count_rows() {
  local url="$1" out=""
  for t in $TABLES; do out+="$t=$(psql "$url" -Atc "SELECT count(*) FROM chat.$t") "; done
  echo "$out"
}

echo "--- restore check"
# The app role must exist for the dump's GRANTs to restore cleanly.
psql "$RESTORE_CHECK_URL" -qc "DO \$\$ BEGIN CREATE ROLE chat_app_user NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
pg_restore --dbname="$RESTORE_CHECK_URL" --no-owner --exit-on-error "$file"
source_counts="$(count_rows "$src")"
restored_counts="$(count_rows "$RESTORE_CHECK_URL")"
echo "source:   $source_counts"
echo "restored: $restored_counts"
# Rows written to production between the dump and the count can make the
# source slightly larger; the restore must never have MORE than the source,
# and must not be missing a table entirely.
for t in $TABLES; do
  s="$(printf '%s\n' $source_counts | sed -n "s/^$t=//p")"
  r="$(printf '%s\n' $restored_counts | sed -n "s/^$t=//p")"
  if [ -z "$r" ] || [ "$r" -gt "$s" ]; then echo "::error::restore check failed for $t (source $s, restored $r)"; exit 1; fi
done
policies="$(psql "$RESTORE_CHECK_URL" -Atc "SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'chat'")"
[ "$policies" -gt 0 ] || { echo "::error::restored database has no tenant isolation policies"; exit 1; }
echo "restore OK ($policies tenant policies present)"

echo "--- uploading"
key="${PREFIX}/$(date -u +%Y/%m)/db-${stamp}.dump"
aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" --endpoint-url "$S3_ENDPOINT" --only-show-errors
aws s3api head-object --bucket "$S3_BUCKET" --key "$key" --endpoint-url "$S3_ENDPOINT" --query ContentLength --output text >/dev/null
echo "uploaded ${key}"

echo "--- pruning backups older than ${RETENTION_DAYS} days"
cutoff="$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%S)"
aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "${PREFIX}/" --endpoint-url "$S3_ENDPOINT" \
  --query "Contents[?LastModified<'${cutoff}'].Key" --output text |
  tr '\t' '\n' | { grep -v -e '^None$' -e '^$' -e "^${key}$" || true; } | while read -r old; do
    aws s3 rm "s3://${S3_BUCKET}/${old}" --endpoint-url "$S3_ENDPOINT" --only-show-errors && echo "removed ${old}"
  done
echo "kept: $(aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "${PREFIX}/" --endpoint-url "$S3_ENDPOINT" --query 'length(Contents)' --output text) backup(s)"
rm -f "$file"
