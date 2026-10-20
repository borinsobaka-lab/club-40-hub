#!/usr/bin/env bash
# Сборка архива виджета для загрузки в amoCRM.
#   bash scripts/build-widget.sh https://rr.example.com
# Результат — widget.zip рядом со скриптом (папка интеграции). manifest.json и
# script.js лежат в корне архива, как требует amoCRM.
set -euo pipefail

SERVER_URL="${1:-}"
SERVER_URL="${SERVER_URL%/}"
if [[ ! "$SERVER_URL" =~ ^https://[^/]+$ ]]; then
  echo "Укажите адрес сервера очереди: bash scripts/build-widget.sh https://rr.example.com" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/widget/." "$TMP/"
sed -i.bak "s#__SERVER_URL__#${SERVER_URL}#g" "$TMP/script.js" "$TMP/manifest.json"
rm -f "$TMP"/*.bak
if grep -q "__SERVER_URL__" "$TMP/script.js" "$TMP/manifest.json"; then
  echo "Не удалось подставить адрес сервера" >&2
  exit 1
fi

rm -f "$ROOT/widget.zip"
(cd "$TMP" && zip -qr -X "$ROOT/widget.zip" manifest.json script.js i18n images)
echo "Готово: $ROOT/widget.zip (сервер $SERVER_URL)"
