#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
-- Força o CAM a ficar due agora
UPDATE torrents
SET "rescrapeAt" = NOW()
WHERE "infoHash" = 'd2b6fbe1146067867e6ba9a99f4fbcf81088c2a4';

-- Mostra o estado
SELECT "infoHash", qualidade, "rescrapeAt", LEFT(title, 40) AS titulo
FROM torrents
WHERE "imdbId" = 'tt12042730'
ORDER BY "rescrapeAt" NULLS LAST;
SQL
