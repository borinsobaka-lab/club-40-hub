# CLUB 40 — админка (club-40-hub)

Админ-панель фитнес-студии CLUB 40. TanStack Start (SSR) + React 19 +
Tailwind 4 + shadcn/radix. Пакетный менеджер — bun.

Связанный репозиторий: `borinsobaka-lab/club40-client-hub` — клиентское
приложение. Оба работают с одной базой Supabase, изменения схемы затрагивают
оба репозитория.

## Команды

- `bun install` — зависимости (только публичный npm-реестр)
- `bun run dev` — дев-сервер на :8080
- `bun run build` — прод-сборка (Nitro node-server → `.output/server/index.mjs`)
- `bunx tsc --noEmit` — типы; должен быть чистым перед коммитом
- `bun run lint` — красный из-за старого форматного долга (Lovable писал без
  prettier); НЕ переформатируй чужие файлы в содержательных коммитах — только
  свои строки

## Деплой

Coolify на Hetzner, приложение `club40-admin`, https://admin.base40.fit.
**Пуш в `main` автоматически деплоится в прод.** Рабочие изменения — в ветку,
merge в main = выкладка. Env-переменные: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` (build-time), `APP_SUPABASE_SERVICE_KEY`
(runtime-секрет, раздел «Сотрудники»). AI-переменные (`AI_GATEWAY_*`,
`AI_CHAT_MODEL`, `AI_TRANSCRIBE_MODEL`) не заданы — ассистент и диктовка
намеренно отвечают 503 до выбора провайдера.

## База данных

- **Источник правды схемы — `db/*.sql` в этом репозитории.** Файлы выполняются
  вручную в Supabase SQL Editor. Новое изменение схемы = новый идемпотентный
  файл (create ... if not exists / drop policy if exists + create).
- `create table if not exists` НЕ добавляет колонки в существующую таблицу —
  для новых колонок нужен явный `alter table ... add column if not exists`
  (на этом уже ловили расхождение: clients.avatar_url был в файле, но не в БД).
- Перед выкаткой миграцию можно прогнать на локальном Postgres 16 (есть в
  системе): заглушки auth/storage + прогон db/*.sql, см. историю сессий.
- Серверная пагинация админки опирается на вью `clients_with_status`,
  `sales_list`, `cash_totals`, `bookings_log_full` (db/performance_indexes.sql),
  все с `security_invoker = true` — RLS действует.
- Известные особенности живой БД: `club_settings` — глобальный синглтон
  (id = true), колонка studio_id в живой БД есть, но не используется;
  `feedback` и `nps_responses` не привязаны к студии (гэп для мультистудии);
  `schedule_days` объявлена в db/, но в живой БД не создана (фича не выкачена).

## Код

- Клиент Supabase в браузере НЕтипизированный (без `<Database>`); свежие типы
  генерировать пока нечем — нужен access token владельца.
- Стиль: русские тексты UI, `@/` алиасы, иконки lucide-имена → Solar через
  alias в vite.config (`src/lib/icons.tsx`).
- Пагинация таблиц: `useServerPagination` + `DataPagination`
  (`src/components/data-pagination.tsx`), поиск через `useDebouncedValue`.
- Файлы страниц в `src/routes/_authenticated/` — самодостаточные (запросы,
  диалоги и таблица в одном файле); при доработке сохраняй этот стиль.

## Документы

- `MIGRATION.md` — план и статус переезда с Lovable
- `INFRA_SETUP.md` — инструкция браузерному агенту (инфраструктура, шаг 9 —
  отключение Lovable)
