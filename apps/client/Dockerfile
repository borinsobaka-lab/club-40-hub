# Сборка и запуск клиентского приложения для Coolify (Nitro node-server, порт 3000).
# Контекст сборки — КОРЕНЬ монорепозитория (Coolify: Base Directory «/»,
# Dockerfile Location «/apps/client/Dockerfile») — так же, как у админки.
FROM oven/bun:1 AS build
WORKDIR /app

COPY apps/client/package.json apps/client/bun.lock apps/client/bunfig.toml ./
RUN bun install --frozen-lockfile

COPY apps/client/ ./

# VITE_* переменные вшиваются в клиентский бандл на этапе сборки —
# в Coolify отметьте их как "Build Variable".
# VITE_APP_FORMAT — формат студий приложения (src/lib/app-format.ts):
# пусто/subscription — app.base40.fit, packages — приложение «пакетных» залов.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_APP_FORMAT
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_APP_FORMAT=$VITE_APP_FORMAT

RUN bun run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
