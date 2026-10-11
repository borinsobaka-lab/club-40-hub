# Base40 — клиентское приложение (apps/client)

Мобильно-ориентированное веб-приложение для клиентов студии (в планах — PWA).
TanStack Start (SSR) + React 19 + Tailwind 4 + shadcn/radix. Пакетный
менеджер — bun.

Это часть монорепозитория: общие правила (рабочий режим, деплой, форматы
студий, база данных и модель доступа) — в корневом `CLAUDE.md`. Админка —
`apps/admin`. Оба приложения работают с одной базой Supabase; **схема БД
ведётся в `db/` в корне репозитория (новые изменения — `db/migrations/`)** — в
`apps/client` файлов схемы нет и быть не должно.

## Два приложения — два формата студий

Студии бывают двух форматов: «Зал с подписочной моделью» (`subscription`) и
«Зал с пакетами тренировок» (`packages`, в разработке). Подробно —
**STUDIO_FORMATS.md в корне репозитория**. Из `apps/client` собираются **два
приложения**: app.base40.fit (подписочный, `VITE_APP_FORMAT` не задан) и
pack.base40.fit (адрес предварительный, `VITE_APP_FORMAT=packages`) —
`src/lib/app-format.ts` (`APP_FORMAT`, `FORMAT_APP_URL`). Деплой второго —
DEPLOY.md, раздел «Второе приложение».

- Подписочное приложение не ломаем: экраны пакетного формата — в
  `src/formats/packages/` (появятся с первой задачей), выбор по `APP_FORMAT`;
  общие экраны (вход, профиль, новости) — общие.
- Регистрация передаёт `studio_id` студии своего формата (`useFormatStudios`,
  `src/hooks/use-studios.ts`): одна студия — молча, несколько — выбор в форме.
- Клиент студии другого формата видит экран «Ваша студия — в другом
  приложении» (`OtherAppScreen` в `__root.tsx`, студия — `useClientStudio`).
- Цвет и логотип студии (`studios.brand_color`/`logo_url`) приходят, но пока
  не применяются: у приложения свой жёлтый `--primary`.
- Пока в базе нет `db/migrations/2026-10-09_studio_formats.sql`, запросы к `studios` падают — хуки
  отдают undefined, и приложение работает как до разделения форматов.

## Команды (из apps/client)

- `bun install` — зависимости (только публичный npm-реестр)
- `bun run dev` — дев-сервер на :8080 (из корня `bun run dev:client` — на :8081,
  чтобы не мешать админке)
- `bun run build` — прод-сборка (Nitro node-server → `.output/server/index.mjs`)
- `bunx tsc --noEmit` — типы; должен быть чистым перед коммитом
- `bun run lint` — форматный долг снят (prettier прогнан целиком); остались
  содержательные замечания — чинить по ходу задач. Форматирование и
  содержательные правки — разными коммитами.

## Рабочий режим

Общий для монорепозитория — корневой `CLAUDE.md`. Если клиентскому коду нужна
новая схема (`db/migrations/`): миграцию выполняет мигратор при деплое
админки, поэтому сначала мержится миграция с админкой, после её деплоя —
клиентская часть. Пока у админки не задан `DATABASE_URL` — в отчёте явно
писать: «сначала выполнить SQL, потом мержить».

## Деплой

Coolify на Hetzner, https://app.base40.fit (инструкция агенту — `DEPLOY.md`).
Пуш в `main` = выкладка. Dockerfile — `apps/client/Dockerfile`, контекст
сборки — корень репозитория. Env: публичные
build-time переменные `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` и
`VITE_APP_FORMAT` (только у пакетного приложения); секретов у этого
приложения нет и быть не должно.

Supabase — **self-hosted в Coolify** (с 2026-10-07): API
`https://api.base40.fit`, ключ — anon в JWT-формате (`eyJ...`, лежит в `.env`
под прежним именем `VITE_SUPABASE_PUBLISHABLE_KEY`). Облачный проект
`lyvarbqquvgxufmqgyix` не используется. Настройки Auth (redirect URLs, Send
Email Hook, лимиты) — переменные `GOTRUE_*` сервиса auth в Coolify, а не
Dashboard. Edge Functions нет.

## Авторизация

Вход по email-коду (6 цифр — Supabase не даёт менять длину; константы
OTP_LENGTH и RESEND_COOLDOWN_SEC = 60 в src/routes/auth.tsx — повторная
отправка кода заблокирована на минуту с обратным отсчётом): `requestOtp`/`verifyOtp` в
`src/hooks/use-auth.tsx` (signInWithOtp / verifyOtp type=email). Регистрация
передаёт метаданные (first_name, last_name, full_name, phone) — их читает
триггер handle_new_user. Паролей у клиентов НЕТ; настройка писем и длины кода
в Supabase — см. AUTH_SETUP.md в корне репозитория. Письма уходят с noreply@base40.fit через Unisender Go (хук в админке,
`UNISENDER_GO_API_KEY` у club40-admin; без ключа — по-старому Resend).

## Данные и мультистудийность

- Студия клиента: `useClientStudioId()` (`src/hooks/use-client-studio.ts`) —
  clients.studio_id с кэшем; гость/нет карточки → null → запросы без фильтра
  (поведение одной студии). Расписание фильтруется по ней; новости и услуги —
  нет: приложение общее для всех студий (решение владельца 2026-10-10);
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
