#!/bin/bash
API_KEY=$(grep TMDB_API_KEY .env | cut -d= -f2 | tr -d '"' | tr -d "'")
echo "=== ARCANE S01 (TMDB ID 94605) — pt-BR ==="
curl -s "https://api.themoviedb.org/3/tv/94605/season/1?api_key=$API_KEY&language=pt-BR" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(ep['episode_number'], '|', ep['name']) for ep in d['episodes'][:3]]"
