# Сервис личных аккаунтов Telegram для CRM. Контекст сборки — корень
# монорепозитория (Coolify: Base Directory «/», Dockerfile Location
# «/integrations/crm-telegram/Dockerfile», Watch Paths
# «integrations/crm-telegram/**»). ОДИН экземпляр: тот же вход в Telegram с
# двух соединений сразу Telegram сбрасывает.
FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data

COPY integrations/crm-telegram/package.json integrations/crm-telegram/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY integrations/crm-telegram/src ./src

# Вход в аккаунты (сессии) — на томе: в Coolify добавить Persistent Storage
# с путём /data, иначе после каждого деплоя придётся входить заново.
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "src/index.ts"]
