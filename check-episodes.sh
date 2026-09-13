#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
SELECT "imdbId", season, "updatedAt",
       CASE WHEN "episodeTitles" IS NULL THEN 'NULL'
            WHEN "episodeTitles"::text = 'null' THEN 'JSON null'
            WHEN "episodeTitles"::text = '[]' THEN 'array vazio'
            ELSE LEFT("episodeTitles"::text, 80)
       END AS episodios
FROM imdb_title_cache
WHERE season > 0
ORDER BY "updatedAt" DESC
LIMIT 10;
SQL
