#!/bin/bash
set -e

DB_USER="postgres"
DB_HOST="localhost"
DB_NAME="brasil_rd_addon"
export PGPASSWORD="postgres"

echo "======================================="
echo " 1. Criando coluna imdbSeasonEnd (se nao existir)"
echo "======================================="
psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -c '
ALTER TABLE torrents
ADD COLUMN IF NOT EXISTS "imdbSeasonEnd" INTEGER;
'

echo ""
echo "======================================="
echo " 2. Estado atual"
echo "======================================="
psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -c '
SELECT COUNT(*) AS pendentes
FROM torrents
WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL;
'

echo ""
echo "======================================="
echo " 3. Amostra dos 10 primeiros"
echo "======================================="
psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -c '
SELECT "infoHash", LEFT(title, 50) AS titulo, "imdbSeason"
FROM torrents
WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL
LIMIT 10;
'

echo ""
echo "======================================="
echo " 4. Aplicando UPDATE"
echo "======================================="
psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -c '
UPDATE torrents
SET "imdbSeasonEnd" = "imdbSeason"
WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL;
'

echo ""
echo "======================================="
echo " 5. Verificacao final"
echo "======================================="
psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -c '
SELECT COUNT(*) AS pendentes
FROM torrents
WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL;
'

echo ""
echo "Pronto."
