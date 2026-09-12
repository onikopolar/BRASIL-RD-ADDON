#!/bin/bash
PGPASSWORD=postgres psql -h localhost -U postgres -d brasil_rd_addon << 'SQL'
-- Total geral
SELECT COUNT(*) AS total FROM torrents;

-- Quantos são Curadoria
SELECT COUNT(*) AS curadoria FROM torrents WHERE provider = 'Curadoria';

-- Quantos são não-Curadoria (pegos pelo destroy atual)
SELECT COUNT(*) AS nao_curadoria FROM torrents WHERE provider != 'Curadoria';

-- Quantos têm provider NULL (fugiriam do destroy atual)
SELECT COUNT(*) AS provider_null FROM torrents WHERE provider IS NULL;

-- Lista os NULL se tiver
SELECT "infoHash", provider, LEFT(title, 50) AS titulo
FROM torrents
WHERE provider IS NULL;
SQL
