# Сборка и запуск админки для Coolify (Nitro preset: node-server, порт 3000).
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .

# VITE_* переменные вшиваются в клиентский бандл на этапе сборки —
# в Coolify отметьте их как "Build Variable".
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN bun run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

COPY --from=build /app/.output ./.output
# Мигратор схемы БД и его файлы: при старте сначала миграции (без
# DATABASE_URL — пропускаются), упали — сервер не запускается.
COPY --from=build /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build /app/db/migrations ./db/migrations

EXPOSE 3000
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun .output/server/index.mjs"]
