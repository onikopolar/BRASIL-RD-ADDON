#!/usr/bin/env bash
# Testa o HDR passo a passo: home → token → busca com cookie e referer.

set -e

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
COOKIE_JAR="/tmp/hdr-cookies.txt"
BASE="https://hdrtorrents.net"
QUERY="${1:-modern+family}"

rm -f "$COOKIE_JAR"

echo "════════════════════════════════════════════"
echo "  1) HOME — pegando token + cookies"
echo "════════════════════════════════════════════"

HOME_CODE=$(curl -s -o /tmp/hdr-home.html -w "%{http_code}" \
  -A "$UA" \
  -H "Accept-Language: pt-BR,pt;q=0.9" \
  -c "$COOKIE_JAR" \
  "$BASE/")

echo "HTTP da home: $HOME_CODE"

TOKEN=$(grep -oE 'name="token" value="[^"]+"' /tmp/hdr-home.html | head -1 | sed 's/.*value="//;s/"//')
echo "Token: ${TOKEN:-(não encontrado)}"

if [ -z "$TOKEN" ]; then
  echo "❌ Sem token — abortando"
  exit 1
fi

echo ""
echo "Cookies salvos:"
cat "$COOKIE_JAR" | grep -v '^#' | awk '{print "  " $6 " = " $7}' | head -10

echo ""
echo "════════════════════════════════════════════"
echo "  2) BUSCA — com token, cookie e referer"
echo "════════════════════════════════════════════"

SEARCH_URL="$BASE/index.php?busca=$QUERY&hp_bot_check=&token=$TOKEN"
echo "URL: $SEARCH_URL"
echo ""

SEARCH_CODE=$(curl -s -o /tmp/hdr-search.html -w "%{http_code}" \
  -A "$UA" \
  -H "Accept-Language: pt-BR,pt;q=0.9" \
  -H "Referer: $BASE/" \
  -b "$COOKIE_JAR" \
  "$SEARCH_URL")

echo "HTTP da busca: $SEARCH_CODE"
echo "Tamanho da resposta: $(wc -c < /tmp/hdr-search.html) bytes"

echo ""
echo "════════════════════════════════════════════"
echo "  3) ANÁLISE DA RESPOSTA"
echo "════════════════════════════════════════════"

if grep -q 'CollectionPage' /tmp/hdr-search.html; then
  echo "✅ Contém CollectionPage — JSON-LD presente"
  echo "   Ocorrências: $(grep -c 'CollectionPage' /tmp/hdr-search.html)"
else
  echo "❌ Sem CollectionPage — busca não retornou resultado válido"
fi

if grep -qi 'captcha\|challenge\|blocked\|forbidden\|access denied' /tmp/hdr-search.html; then
  echo "⚠️  Possível página de bloqueio/captcha"
fi

TITLE=$(grep -oE '<title>[^<]+</title>' /tmp/hdr-search.html | head -1 | sed 's/<[^>]*>//g')
echo "Título da página: $TITLE"

echo ""
echo "════════════════════════════════════════════"
echo "  VEREDITO"
echo "════════════════════════════════════════════"

case "$HOME_CODE-$SEARCH_CODE" in
  200-200) echo "✅ Home 200 + Busca 200 → HDR OK, problema é no código do scraper" ;;
  200-403) echo "🟡 Home 200 + Busca 403 → WAF bloqueia busca. Falta header ou fingerprint TLS" ;;
  200-3*)  echo "🟡 Home 200 + Busca $SEARCH_CODE → redirect. Token expirou ou referer errado" ;;
  200-5*)  echo "🟡 Home 200 + Busca $SEARCH_CODE → erro do HDR" ;;
  403-*)   echo "❌ Home 403 → IP bloqueado de cara" ;;
  *)       echo "❓ Combinação inesperada: home=$HOME_CODE busca=$SEARCH_CODE" ;;
esac

echo ""
echo "Arquivos salvos pra inspecionar:"
echo "  /tmp/hdr-home.html"
echo "  /tmp/hdr-search.html"
echo "  $COOKIE_JAR"
