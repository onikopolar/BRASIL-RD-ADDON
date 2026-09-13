#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
SELECT COUNT(*) FROM imdb_title_cache;
SELECT "imdbId", season, "updatedAt" FROM imdb_title_cache ORDER BY "updatedAt" DESC LIMIT 5;
SQL
