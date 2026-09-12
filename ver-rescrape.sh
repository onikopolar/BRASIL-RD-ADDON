#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
SELECT "infoHash", qualidade, "rescrapeAt", LEFT(title, 50) AS titulo
FROM torrents
WHERE "imdbId" = 'tt12042730'
ORDER BY "rescrapeAt" NULLS LAST;
SQL
