#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
SELECT "infoHash", LEFT(magnet, 120) AS magnet_preview
FROM torrents
WHERE "imdbId" = 'tt4574334'
LIMIT 5;
SQL
