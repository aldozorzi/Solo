#!/bin/sh
# Backup del database PostgreSQL via pg_dump (dentro il container: nessun client locale richiesto).
# Uso:  ./scripts/backup-db.sh
# Env:  POSTGRES_CONTAINER (default: solo-postgres), POSTGRES_USER (default: solo),
#       POSTGRES_DB (default: solo), BACKUP_DIR (default: ./backups), BACKUP_KEEP (default: 14)
# Conserva gli ultimi BACKUP_KEEP dump e stampa il file creato. Mai contro produzione
# senza aver verificato le variabili: lo script mostra sempre container e DB prima di partire.
set -eu

CONTAINER="${POSTGRES_CONTAINER:-solo-postgres}"
DB_USER="${POSTGRES_USER:-solo}"
DB_NAME="${POSTGRES_DB:-solo}"
OUT_DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP:-14}"

echo "Backup di '${DB_NAME}' dal container '${CONTAINER}' in '${OUT_DIR}' (conservo gli ultimi ${KEEP})..."
mkdir -p "$OUT_DIR"
TS=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/solo-$TS.sql.gz"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILE"

# Rotazione: tieni solo i più recenti.
# shellcheck disable=SC2012
ls -t "$OUT_DIR"/solo-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -- || true

echo "Backup completato: $FILE"
ls -lh "$FILE"
