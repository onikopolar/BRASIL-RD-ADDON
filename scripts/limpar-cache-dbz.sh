#!/usr/bin/env bash
# Limpa o cache de títulos do DBZ no Postgres — força o servidor a refazer
# o /find (e cair no fallback Cinemeta).

set -e

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/brasil_rd_addon?sslmode=disable}"
IMDB_ID="tt0214341"

echo "🔍 Listando tabelas com 'imdb' no nome..."
psql "$DB_URL" -c "SELECT tablename FROM pg_tables WHERE tablename ILIKE '%imdb%';"

echo ""
echo "🗑️  Apagando linhas de $IMDB_ID em ImdbTitleCaches..."
psql "$DB_URL" -c "DELETE FROM \"ImdbTitleCaches\" WHERE \"imdbId\" = '$IMDB_ID';"

echo ""
echo "✅ Confirmação (deve vir vazio):"
psql "$DB_URL" -c "SELECT \"imdbId\", season, \"updatedAt\" FROM \"ImdbTitleCaches\" WHERE \"imdbId\" = '$IMDB_ID';"

echo ""
echo "🏁 Pronto. Roda 'npm run build && npm run dev:local' e testa de novo."
