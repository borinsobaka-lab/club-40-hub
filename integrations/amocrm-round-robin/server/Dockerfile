# Сервер очереди ответственных amoCRM. Контекст сборки — корень монорепозитория
# (Coolify: Base Directory «/», Dockerfile Location
# «/integrations/amocrm-round-robin/server/Dockerfile»,
# Watch Paths «integrations/amocrm-round-robin/server/**»).
FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/round-robin.sqlite

COPY integrations/amocrm-round-robin/server/src ./src

# Очередь, токены amoCRM и журнал — в SQLite на томе: в Coolify добавить
# Persistent Storage с путём /data, иначе при деплое всё обнулится и
# интеграцию придётся переустанавливать.
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "src/index.ts"]
