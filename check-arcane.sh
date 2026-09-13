#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
SELECT "imdbId", season, "episodeTitles"::text
FROM imdb_title_cache
WHERE "imdbId" = 'tt11126994' AND season = 1;
SQL
