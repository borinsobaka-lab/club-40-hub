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
- `bun run lint` — форматный долг снят (prettier прогнан целиком); остались
  содержательные замечания — чинить по ходу задач. Форматирование и
  содержательные правки — разными коммитами.

## Рабочий режим (согласован с владельцем)

- Изменения — в ветку `claude/*`, пуш, короткий отчёт владельцу.
- **Сейчас проект на тестировании: Claude мержит в `main` сам** (решение
  владельца от 2026-08-06, временные поломки допустимы). После боевого
  запуска режим меняется: в `main` мержит владелец после проверки.
- Если изменение кода требует миграции БД (файлы db/\*.sql в club-40-hub), в
  отчёте явно писать: «сначала выполнить SQL, потом мержить».

## Деплой

Coolify на Hetzner, https://app.base40.fit (инструкция агенту — `DEPLOY.md`).
После подключения автодеплоя пуш в `main` = выкладка. Env: только три
публичные `VITE_SUPABASE_*` переменные (build-time); секретов у этого
приложения нет и быть не должно.

## Авторизация

Вход по email-коду (6 цифр — Supabase не даёт менять длину; константа
OTP_LENGTH в src/routes/auth.tsx): `requestOtp`/`verifyOtp` в
`src/hooks/use-auth.tsx` (signInWithOtp / verifyOtp type=email). Регистрация
передаёт метаданные (first_name, last_name, full_name, phone) — их читает
триггер handle_new_user. Паролей у клиентов НЕТ; настройка писем и длины кода
в Supabase — см. AUTH_SETUP.md. Письма уходят с noreply@base40.fit (Resend).

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
