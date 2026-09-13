#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
SELECT "imdbId", season,
       "updatedAt",
       (NOW() - "updatedAt") AS idade,
       CASE WHEN "episodeTitles" IS NULL THEN 'NULL'
            WHEN "episodeTitles"::text = '[]' THEN 'VAZIO'
            ELSE 'TEM_DADOS'
       END AS status_ep
FROM imdb_title_cache
WHERE "imdbId" = 'tt4574334';
SQL
