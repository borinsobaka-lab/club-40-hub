# CLUB 40 — клиентское приложение (club40-client-hub)

Мобильно-ориентированное веб-приложение для клиентов студии (в планах — PWA).
TanStack Start (SSR) + React 19 + Tailwind 4 + shadcn/radix. Пакетный
менеджер — bun.

Связанный репозиторий: `borinsobaka-lab/club-40-hub` — админка. Оба работают
с одной базой Supabase; **схема БД ведётся там, в `db/*.sql`** — здесь файлов
схемы нет и быть не должно.

## Команды

- `bun install` — зависимости (только публичный npm-реестр)
- `bun run dev` — дев-сервер на :8080
- `bun run build` — прод-сборка (Nitro node-server → `.output/server/index.mjs`)
- `bunx tsc --noEmit` — типы; должен быть чистым перед коммитом
- `bun run lint` — красный из-за старого форматного долга; не переформатируй
  чужие файлы в содержательных коммитах

## Деплой

Coolify на Hetzner, https://app.base40.fit (инструкция агенту — `DEPLOY.md`).
После подключения автодеплоя пуш в `main` = выкладка. Env: только три
публичные `VITE_SUPABASE_*` переменные (build-time); секретов у этого
приложения нет и быть не должно.

## Данные и мультистудийность

- Студия клиента: `useClientStudioId()` (`src/hooks/use-client-studio.ts`) —
  clients.studio_id с кэшем; гость/нет карточки → null → запросы без фильтра
  (поведение одной студии). Расписание, новости, услуги фильтруются по ней;
  тарифы — по студии из карточки клиента (memberships.tsx).
- «Мои записи» всегда фильтровать `.eq("user_id", user.id)` явно — RLS
  разрешает тренеру видеть все брони студии.
- Запись на тренировку — только через RPC `book_schedule_entry` /
  `cancel_schedule_booking` (атомарные, без овербукинга). Никаких прямых
  insert в schedule_bookings.
- `club_settings` — глобальный синглтон (id = true), см. use-club-settings.
- Обратная связь — внешняя ссылка (club_settings.feedback_url); приложение
  НЕ пишет в feedback/nps_responses.

## Типы

`src/integrations/supabase/types.ts` сгенерирован из старого (мёртвого)
проекта и отстаёт от живой схемы; колонки с пометкой `/* patched */`
добавлены вручную и проверены запросом к живой БД. Оставшиеся
`(supabase as any)` — по таблицам, которых в types нет (services,
memberships, sales, bookings_log, client_stats_30d_mv...). TODO: полная
регенерация `supabase gen types typescript` (нужен access token владельца).

## PWA (следующий этап)

Манифеста и service worker пока нет. Перед PWA: самостоятельный хостинг
шрифтов (сейчас Google Sans с CDN Google; учесть лицензию — шрифт
проприетарный), офлайн-стратегия для расписания.
