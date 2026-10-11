# Base40 — монорепозиторий: админка + клиентское приложение

Фитнес-студия Base40: два продукта на одной базе Supabase. Оба — TanStack
Start (SSR) + React 19 + Tailwind 4 + shadcn/radix, пакетный менеджер — bun.

## Структура

- `apps/admin/` — админ-панель, https://admin.base40.fit. Свой **CLAUDE.md**
  (код, слой данных, auth-письма, сервер) — читать перед правками в админке.
- `apps/client/` — клиентское приложение: https://app.base40.fit
  (подписочный формат) и pack.base40.fit (пакетный, `VITE_APP_FORMAT=packages`)
  — одна кодовая база, две сборки. Свой **CLAUDE.md**.
- `db/` — схема БД, общая для обоих приложений: `db/migrations/` + мигратор
  `db/migrate.ts` (выполняется при старте контейнера админки).
- Документы проекта — в корне (см. «Документы»).

До 2026-10-10 это были два репозитория: `club-40-hub` (админка) и
`club40-client-hub` (клиент). История обоих перенесена сюда целиком
(`git log -- apps/client/src/...` показывает и старые коммиты клиента).
`club40-client-hub` удалён 2026-10-10 — всё здесь.

Приложения пока **независимы**: у каждого свой `package.json`, `bun.lock`,
`tsconfig`, eslint/prettier и `.env`; общих пакетов (bun workspaces) нет.
Похожий код (ui-компоненты, `format.ts`, клиент Supabase) продублирован.
Выносить общее в `packages/` — отдельной задачей: единый lockfile поднимет
версии зависимостей у обоих приложений, проверять обе сборки и оба Dockerfile.

## Команды (из корня)

- `bun run setup` — зависимости обоих приложений (только публичный
  npm-реестр)
- `bun run dev:admin` (:8080), `bun run dev:client` (:8081)
- `bun run typecheck` — `tsc --noEmit` в обоих приложениях; должен быть чистым
  перед коммитом
- `bun run lint`, `bun run test`, `bun run build` — то же по обоим
- `bun run test:db` — тесты мигратора (без `TEST_DATABASE_URL` пропускаются)
- Внутри приложения работают его собственные команды
  (`cd apps/admin && bun run dev`) — см. CLAUDE.md приложения.

## Форматы студий — читать перед любой задачей

Студии бывают двух форматов (`studios.format`): **«Зал с подписочной
моделью»** (`subscription`, всё сделанное до 2026-10-09) и **«Зал с пакетами
тренировок»** (`packages`, в разработке — абонементы, тренировки, расписание
будут другими). У каждого формата своё клиентское приложение (две сборки
`apps/client`). Подписочный формат не ломаем: пакетный добавляется рядом.
Подробно, правила и журнал решений по пакетному формату — **STUDIO_FORMATS.md**
(держать актуальным). Студии заводятся в разделе «Студии» админки (рейка слева
от меню): тип, логотип в меню, основной цвет (`--brand` админки при открытой
студии).

## Рабочий режим (согласован с владельцем)

- Изменения — в ветку `claude/*`, пуш, короткий отчёт владельцу.
- **Сейчас проект на тестировании: Claude мержит в `main` сам** (решение
  владельца от 2026-08-06, временные поломки допустимы). После боевого
  запуска режим меняется: в `main` мержит владелец после проверки
  (merge в main = автодеплой в прод).
- Одна задача может менять оба приложения и схему сразу — одной веткой. Но
  деплоятся они независимо и параллельно (см. «Деплой»), а миграции выполняет
  только админка при своём старте. Поэтому если клиентский код читает новые
  колонки — два merge: сначала миграция (и админка), дождаться деплоя
  админки, потом клиентская часть. Иначе клиент может выйти раньше схемы.
- Пока у club40-admin не задан `DATABASE_URL`, мигратор молчит — тогда в
  отчёте явно писать: «сначала выполнить db/migrations/<файл>.sql в Supabase
  SQL Editor, потом мержить» — код, который запрашивает несуществующие
  колонки, кладёт страницу целиком.
- Секретов в репозитории нет и не должно быть; Supabase access token для
  регенерации типов владелец передаст отдельно (пока не передан).
- Форматирование и содержательные правки — разными коммитами.

## Деплой

Coolify на Hetzner, все приложения — из этого репозитория, ветка `main`.
**Пуш в `main` автоматически деплоится в прод.** Контекст сборки Docker —
корень репозитория (общий `.dockerignore`), Dockerfile — в папке приложения:

| Ресурс Coolify           | Адрес                    | Dockerfile                | Watch Paths              |
| ------------------------ | ------------------------ | ------------------------- | ------------------------ |
| `club40-admin`           | https://admin.base40.fit | `/apps/admin/Dockerfile`  | `apps/admin/**`, `db/**` |
| `club40-client`          | https://app.base40.fit   | `/apps/client/Dockerfile` | `apps/client/**`         |
| `club40-client-packages` | https://pack.base40.fit  | `/apps/client/Dockerfile` | `apps/client/**`         |

Watch Paths — чтобы правка одного приложения не пересобирала другие.
Переменные окружения каждого приложения — в его CLAUDE.md; переключение
Coolify на монорепозиторий — AGENT_TASKS.md, Задача 9.

Supabase — **self-hosted в Coolify** (с 2026-10-07): API
`https://api.base40.fit`, публичный ключ — anon в JWT-формате (`eyJ...`, в
`.env` приложений под прежним именем `VITE_SUPABASE_PUBLISHABLE_KEY`);
`APP_SUPABASE_SERVICE_KEY` (только у админки) — service*role JWT этого же
инстанса. Облачный проект `lyvarbqquvgxufmqgyix` не используется. Настройки
Auth (redirect URLs, Send Email Hook, лимиты) — переменные `GOTRUE*\*` сервиса
auth в Coolify; SQL — через Studio. Edge Functions нет.

## Авторизация (оба приложения)

Вход везде — по 6-значному коду из письма, паролей нет ни у клиентов, ни у
сотрудников. Письма для обоих приложений шлёт хук в админке
(`/api/auth-email`) — подробно в `apps/admin/CLAUDE.md` («Auth-письма»),
клиентская сторона — `apps/client/CLAUDE.md` («Авторизация»), настройка —
AUTH_SETUP.md.

## База данных

- Удаление занятия: `db/migrations/2026-10-10_schedule_entry_delete.sql` —
  журнал записей удалённого занятия переводится в «Отменено» (раньше оставался
  «Забронировано», а потом превращался в пропуски клиентов); там же разовое
  исправление истории. Сотрудники: `db/migrations/2026-10-10_staff_accounts.sql`
  — без паролей, без карточек клиентов (`handle_new_user` — копия из
  `db/client_app_fixes.sql`, держать в синхроне).
  Справочник сотрудников над студиями: `db/migrations/2026-10-10_staff_directory.sql`
  — `trainers` (тренеры и администраторы, `role`) без `studio_id`, студии —
  `trainer_studios`; реквизиты `trainer_bank_details` и зарплатные ставки
  `trainer_pay_rates` — только сотрудникам (клиенты видят тренеров своей
  студии в расписании, но не счёт и не ставки). Это НЕ доступ в админку —
  тот в `user_roles` («Доступы»). Права в админке:
  `db/migrations/2026-10-10_admin_permissions.sql` — студии = роль в
  `user_roles`, разделы рейки («Клуб»/«Сотрудники»/«Мобильное приложение») —
  `admin_permissions`, разделы клуба по студиям — `admin_studio_permissions`
  (нет строки — открыто всё; владельцу — всё). RLS проверяет разделы рейки
  (`has_admin_section`: правка сотрудников, реквизиты и ставки; новости,
  услуги, пуши, `club_settings`), разделы клуба скрывает только интерфейс —
  их таблицы общие, граница там по-прежнему студия. Мобильное приложение общее для студий:
  `db/migrations/2026-10-10_app_content_shared.sql` — `news`/`services`/
  `push_notifications` без привязки к студии, правка — `is_staff`.
  «Скрипты LS» (скрипты администраторов Lady Stretch, перенос из
  «Аудиоаналитики»): `db/migrations/2026-10-10_scripts_ls.sql` — таблицы
  `scripts_*` без studio_id (раздел общий для студий), доступ — разделы рейки
  `scripts` / `scripts-edit` в `admin_permissions` (`has_admin_section`);
  подписи и хронологию пишут триггеры, статистика — RPC `scripts_copy_stats` /
  `scripts_call_stats`, импорт — `scripts_import`.
  Номенклатура пакетных студий: `db/migrations/2026-10-10_packages_memberships.sql`
  — триггер, выключающий автопродление в пакетных студиях (добавленный там
  `for_regular_clients` убран `2026-10-11_packages_no_regular_price.sql`).
  Цвет тренировки (пакетный формат, полоска в расписании):
  `db/migrations/2026-10-11_workout_color.sql` — `workouts.color`.
  Форматы и брендинг студий: `db/migrations/2026-10-09_studio_formats.sql` (`format`, `brand_color`,
  `logo_url`, публичное чтение `studios`, RPC `create_studio`, бакет
  `studio-logos`). Удаление студии — RPC `delete_studio`
  (`db/migrations/2026-10-10_studio_delete.sql`, только владелец этой студии):
  каскадом все данные студии; профили людей переносятся в другие студии,
  общий контент приложения отвязывается от студии.
- **Источник правды схемы — `db/` в корне репозитория** (общая для обоих
  приложений). Новое изменение
  схемы = новый файл `db/migrations/ГГГГ-ММ-ДД_имя.sql` (с 2026-10-09).
  Мигратор `db/migrate.ts` запускается в контейнере админки перед сервером
  (`apps/admin/Dockerfile`): выполняет невыполненные файлы по порядку имён, каждый в
  транзакции, и отмечает их в `app_migrations.applied`; ошибка — откат файла и
  сервер не стартует (Coolify ждёт «healthy» нового контейнера —
  HEALTHCHECK в `apps/admin/Dockerfile` на bun — и оставляет прежний). Правила: файл не править после
  выкатки (исправление — новый файл), без `begin/commit` и
  `create index concurrently` внутри, по-прежнему идемпотентно (create ... if
  not exists / drop policy if exists + create) — его могут выполнить и
  вручную. Тесты мигратора на локальном Postgres —
  `TEST_DATABASE_URL=… bun test db` (из корня).
- Старые `db/*.sql` (вне `migrations/`) — история, выполнялись вручную в
  Supabase SQL Editor; мигратор их не трогает. Что из них ещё не выполнено —
  AGENT_TASKS.md.
- `create table if not exists` НЕ добавляет колонки в существующую таблицу —
  для новых колонок нужен явный `alter table ... add column if not exists`
  (на этом уже ловили расхождение: clients.avatar_url был в файле, но не в БД).
- Перед выкаткой миграцию можно прогнать на локальном Postgres 16 (есть в
  системе): заглушки auth/storage + прогон db/\*.sql, см. историю сессий.
- Серверная пагинация админки опирается на вью `clients_with_status`,
  `sales_list`, `cash_totals`, `bookings_log_full` (db/performance_indexes.sql),
  все с `security_invoker = true` — RLS действует.
- **Модель доступа: граница безопасности — RLS, не фронтенд.** Publishable-ключ
  вшит в бандл, любой может дёргать PostgREST напрямую. Guard'ы роутов —
  только UX. Все клиентские таблицы читаются по принципу «своя строка или
  сотрудник» (`is_trainer`/`has_role`); витринные `news`/`services`/
  `club_settings` — публичны намеренно. Каждый новый пользователь получает роль
  `member` (auth_trigger.sql), поэтому «просто авторизован» ≠ «сотрудник» —
  проверять роль явно. Хелперы: `has_role`, `is_trainer`, `is_staff` (staff в
  любой студии — для пулов без studio_id: feedback/nps). Правки доступа собраны
  в `db/security_hardening.sql` (аудит 2026-08-07): ужесточён select у
  `clients`/`client_memberships`, закрыт IDOR в `cancel_membership*`,
  `feedback`/`nps` — чтение/правка только сотрудник. Storage: запись/удаление в
  маркетинговых бакетах (news/services/memberships/trainer/workout-media) —
  только сотрудник, фото тренеров — с разделом «Сотрудники», новости и услуги —
  с «Мобильным приложением» (`db/migrations/2026-10-10_storage_media_write.sql`,
  заменил `db/storage_hardening.sql`); бакет `avatars` пишется в свою
  папку `{uid}/`. **`security_hardening.sql` прогнать в SQL Editor (см.
  AGENT_TASKS.md, Задача 0).**
- SECURITY DEFINER-функции, выданные `authenticated`, обходят RLS — обязаны
  сами проверять вызывающего (`auth.uid()` — владелец записи или `is_trainer`).
  Серверные роуты админки (chat/transcribe) — только для сотрудников через
  `authenticateStaff` (`apps/admin/src/lib/staff-auth.server.ts`), серверные функции —
  через middleware `requireStaff`/`requireOwner`
  (`apps/admin/src/integrations/supabase/auth-middleware.ts`). Service-ключ
  (`getSupabaseAdmin`) — только после такой проверки и только для того, что
  RLS не позволяет (`auth.admin.*`).
- **⚠️ Предрелизный риск (оплата): покупка абонемента клиентом — сейчас
  МУЛЯЖ без оплаты.** `handlePurchase` в клиенте (`apps/client`) вставляет строку в `sales`
  (политика `sales client insert own`, self-scoped: только своя строка в своей
  студии), а триггер `activate_membership_from_sale` выдаёт абонемент. Пока
  эквайринг не подключён — клиент фактически выдаёт себе абонемент бесплатно;
  владелец принял это осознанно на стадии тестов (2026-08-07). **Перед боевым
  запуском обязательно:** создание продажи вынести на сервер за проверку
  платежа (webhook/подтверждение провайдера), а клиентскую вставку в `sales`
  отозвать (`drop policy "sales client insert own"` + `"sales client select
own"` оставить). Альтернатива — выдача абонемента только сотрудником из
  админки (политика `sales studio rw` уже это позволяет).
- Аналитика/новые фичи (аудит данных 2026-08-07, прогон — AGENT_TASKS Задача 6):
  `other_sales.sql` (каталог `sale_items` + продажи услуг/товаров `other_sales`,
  отдельно от абонементов); `sales_payment.sql` (оплата/скидки на
  `sales`/`other_sales` + `refunds`); `membership_freeze.sql` (заморозка:
  `memberships.freeze_days_allowed`, статус `frozen`, `membership_freezes`, RPC
  `freeze_membership`/`unfreeze_membership`; новая продажа вытесняет и
  замороженный абонемент); `booking_hygiene.sql` (единый словарь статусов
  посещений `booked|waitlist|attended|no_show|cancelled`, `expire_memberships()`,
  триггер `last_visit_date`, `cancel_reason`/`cancelled_lead_minutes` + причина в
  `cancel_schedule_booking*`). Вейт-лист (запись в очередь при заполнении) —
  отдельным заходом с UI.
- Известные особенности живой БД: `club_settings` — глобальный синглтон
  (id = true), колонка studio_id в живой БД есть, но не используется;
  `feedback` и `nps_responses` не привязаны к студии (гэп для мультистудии);
  `schedule_days` объявлена в db/, но в живой БД не создана (фича не выкачена).

## Документы

- `AGENT_TASKS.md` — **актуальный список задач браузерному агенту** (ручные
  шаги в веб-панелях: миграции, ключи, хуки, Coolify). Держать в актуальном
  состоянии.
- `STUDIO_FORMATS.md` — форматы студий, журнал решений по пакетному формату.
- `AUTH_SETUP.md` — настройка почтовой авторизации (хук писем, Unisender Go).
- `apps/client/DEPLOY.md` — деплой клиентских приложений в Coolify.
- `MIGRATION.md` — план и статус переезда с Lovable
- `INFRA_SETUP.md` — инструкция браузерному агенту (инфраструктура, шаг 9 —
  отключение Lovable)
