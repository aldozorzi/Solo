#!/bin/sh
# Ripristino di un dump creato con backup-db.sh.
# Uso:  ./scripts/restore-db.sh backups/solo-YYYYMMDD-HHMMSS.sql.gz
# Env:  POSTGRES_CONTAINER (default: solo-postgres), POSTGRES_USER/DB (default: solo/solo)
#
# SICUREZZA: l'operazione SVUOTA lo schema public del database di destinazione.
# - Si rifiuta di girare senza conferma esplicita (CONFIRM_RESTORE=I-UNDERSTAND).
# - Si rifiuta se il target sembra produzione (solo con ALLOW_PROD_RESTORE=1).
# Consiglio: provare prima il restore su un database temporaneo/scratch.
set -eu

if [ $# -ne 1 ]; then
  echo "Uso: $0 backups/solo-YYYYMMDD-HHMMSS.sql.gz" >&2
  exit 2
fi
DUMP="$1"
[ -f "$DUMP" ] || { echo "File non trovato: $DUMP" >&2; exit 2; }

CONTAINER="${POSTGRES_CONTAINER:-solo-postgres}"
DB_USER="${POSTGRES_USER:-solo}"
DB_NAME="${POSTGRES_DB:-solo}"

case "$DB_NAME" in
  *prod*) ALLOW_PROD_RESTORE="${ALLOW_PROD_RESTORE:-0}" ;;
  *) ALLOW_PROD_RESTORE=1 ;;
esac
if [ "${CONFIRM_RESTORE:-}" != "I-UNDERSTAND" ]; then
  echo "ABORT: restore distruttivo. Riesegui con CONFIRM_RESTORE=I-UNDERSTAND" >&2
  echo "Target: container='${CONTAINER}' db='${DB_NAME}' file='${DUMP}'" >&2
  exit 2
fi
if [ "$ALLOW_PROD_RESTORE" != "1" ]; then
  echo "ABORT: il nome DB sembra di produzione. Imposta ALLOW_PROD_RESTORE=1 per forzare." >&2
  exit 2
fi

echo "ATTENZIONE: svuoto lo schema public di '${DB_NAME}' e carico '${DUMP}'..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q
echo "Restore completato. Verifica i conteggi prima di usare l'app."
