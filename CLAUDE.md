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
- `bun test` — тесты (сейчас: логика auth-писем). Файлы `*.test.ts` исключены
  из tsc: глобальные типы Bun конфликтуют с DOM-типами приложения.
- `bun run lint` — форматный долг снят (prettier прогнан целиком); остались
  содержательные замечания (no-explicit-any, exhaustive-deps) — чинить по ходу
  задач. Форматирование и содержательные правки — разными коммитами.

## Рабочий режим (согласован с владельцем)

- Изменения — в ветку `claude/*`, пуш, короткий отчёт владельцу.
- **Сейчас проект на тестировании: Claude мержит в `main` сам** (решение
  владельца от 2026-08-06, временные поломки допустимы). После боевого
  запуска режим меняется: в `main` мержит владелец после проверки
  (merge в main = автодеплой в прод).
- Если изменение кода требует миграции БД, в отчёте явно писать: «сначала
  выполнить db/<файл>.sql в Supabase SQL Editor, потом мержить» — код, который
  запрашивает несуществующие колонки, кладёт страницу целиком.
- Секретов в репозитории нет и не должно быть; Supabase access token для
  регенерации типов владелец передаст отдельно (пока не передан).

## Деплой

Coolify на Hetzner, приложение `club40-admin`, https://admin.base40.fit.
**Пуш в `main` автоматически деплоится в прод.** Рабочие изменения — в ветку,
merge в main = выкладка. Env-переменные: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` (build-time), `APP_SUPABASE_SERVICE_KEY`
(runtime-секрет, раздел «Сотрудники»). AI-переменные (`AI_GATEWAY_*`,
`AI_CHAT_MODEL`, `AI_TRANSCRIBE_MODEL`) не заданы — ассистент и диктовка
намеренно отвечают 503 до выбора провайдера.

## Auth-письма

Send Email Hook: Supabase дёргает /api/auth-email (src/routes/api/auth-email.ts),
логика писем — src/lib/auth-email.ts (+ тест auth-email.test.ts), отправка
через Resend с noreply@base40.fit.

**Разделение по ПРИЛОЖЕНИЮ, а не по человеку**: админка и клиентское
приложение — разные сущности, один человек может быть и админом, и клиентом.
Признак — хост в redirect_to (оба приложения задают emailRedirectTo явно):
admin.base40.fit -> ссылка авто-входа, всё остальное (включая нераспознанный
redirect) -> 4-значный код. Env: SEND_EMAIL_HOOK_SECRET, RESEND_API_KEY,
опционально ADMIN_APP_URL (runtime, Coolify). Настройка — AUTH_SETUP.md
в club40-client-hub.

В админку пускаем только сотрудников: проверка user_roles есть и в guard
(\_authenticated/route.tsx), и на форме входа до отправки письма.

## База данных

- **Источник правды схемы — `db/*.sql` в этом репозитории.** Файлы выполняются
  вручную в Supabase SQL Editor. Новое изменение схемы = новый идемпотентный
  файл (create ... if not exists / drop policy if exists + create).
- `create table if not exists` НЕ добавляет колонки в существующую таблицу —
  для новых колонок нужен явный `alter table ... add column if not exists`
  (на этом уже ловили расхождение: clients.avatar_url был в файле, но не в БД).
- Перед выкаткой миграцию можно прогнать на локальном Postgres 16 (есть в
  системе): заглушки auth/storage + прогон db/\*.sql, см. историю сессий.
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

- `AGENT_TASKS.md` — **актуальный список задач браузерному агенту** (ручные
  шаги в веб-панелях: миграции, ключи, хуки). Держать в актуальном состоянии.
- `MIGRATION.md` — план и статус переезда с Lovable
- `INFRA_SETUP.md` — инструкция браузерному агенту (инфраструктура, шаг 9 —
  отключение Lovable)
