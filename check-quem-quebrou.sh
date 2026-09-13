#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
-- Conta quantos têm mojibake no namePt
SELECT
  CASE
    WHEN "episodeTitles"::text LIKE '%Ã%' THEN 'COM_MOJIBAKE'
    ELSE 'OK'
  END AS status,
  COUNT(*)
FROM imdb_title_cache
WHERE "episodeTitles" IS NOT NULL
GROUP BY 1;
SQL
