#!/bin/bash

API_KEY="34009def65190c8203f84b2dacf0ceb4"
TMDB="https://api.themoviedb.org/3"

echo "═══════════════════════════════════════════════════════════════"
echo "1) FIND por IMDb ID tt12759778"
echo "═══════════════════════════════════════════════════════════════"
curl -s "${TMDB}/find/tt12759778?api_key=${API_KEY}&external_source=imdb_id&language=pt-BR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "2) TV 106349 em pt-BR"
echo "═══════════════════════════════════════════════════════════════"
curl -s "${TMDB}/tv/106349?api_key=${API_KEY}&language=pt-BR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "3) TV 106349 em en-US"
echo "═══════════════════════════════════════════════════════════════"
curl -s "${TMDB}/tv/106349?api_key=${API_KEY}&language=en-US"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "4) TV 106349 temporada 1 em pt-BR"
echo "═══════════════════════════════════════════════════════════════"
curl -s "${TMDB}/tv/106349/season/1?api_key=${API_KEY}&language=pt-BR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "5) IMDb direto (sanity check)"
echo "═══════════════════════════════════════════════════════════════"
curl -sL "https://www.imdb.com/title/tt12759778/" \
  -H 'User-Agent: Mozilla/5.0' \
  -H 'Accept-Language: pt-BR,pt;q=0.9' \
  | grep -oE '<title>[^<]+</title>' | head -1

echo ""
