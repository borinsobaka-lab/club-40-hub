#!/usr/bin/env bash
# Перенести ключ подписи обновлений из прежней папки приложения
# (репозиторий audio-analitics, папка desktop) сюда, в apps/recorder.
#
# Зачем: приложения на ресепшенах принимают только сборки, подписанные ТЕМ
# ЖЕ ключом. Новый ключ (npm run keygen) отрезал бы их от обновлений — пришлось
# бы обходить студии. С перенесённым ключом первая сборка из монорепозитория
# ставится на ресепшенах кнопкой «Обновить», как и раньше.
#
#   bash scripts/import-key.sh ~/Downloads/audio-analitics/desktop
set -euo pipefail

cd "$(dirname "$0")/.."
OLD="${1:?укажите прежнюю папку приложения: …/audio-analitics/desktop}"
OLD_KEY="$OLD/src-tauri/updater.key"

if [ ! -f "$OLD_KEY" ] || [ ! -f "$OLD_KEY.pub" ]; then
  echo "❌ В $OLD/src-tauri нет updater.key и updater.key.pub."
  echo "   Ключ лежит на маке, где когда-то запускали npm run keygen."
  exit 1
fi
if [ -f src-tauri/updater.key ] && ! cmp -s "$OLD_KEY" src-tauri/updater.key; then
  echo "❌ Здесь уже лежит другой src-tauri/updater.key — не перезаписываю."
  exit 1
fi

cp "$OLD_KEY" src-tauri/updater.key
cp "$OLD_KEY.pub" src-tauri/updater.key.pub
PUB=$(cat src-tauri/updater.key.pub)

node -e '
const fs = require("fs");
const path = "src-tauri/tauri.conf.json";
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.plugins = config.plugins || {};
config.plugins.updater = config.plugins.updater || {};
config.plugins.updater.pubkey = process.argv[1];
fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
' "$PUB"

echo "✅ Ключ перенесён, публичный вписан в src-tauri/tauri.conf.json."
