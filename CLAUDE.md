# Base40 — админка (club-40-hub)

Админ-панель фитнес-студии Base40. TanStack Start (SSR) + React 19 +
Tailwind 4 + shadcn/radix. Пакетный менеджер — bun.

Связанный репозиторий: `borinsobaka-lab/club40-client-hub` — клиентское
приложение. Оба работают с одной базой Supabase, изменения схемы затрагивают
оба репозитория.

## Команды

- `bun install` — зависимости (только публичный npm-реестр)
- `bun run dev` — дев-сервер на :8080
- `bun run build` — прод-сборка (Nitro node-server → `.output/server/index.mjs`)
- `bunx tsc --noEmit` — типы; должен быть чистым перед коммитом
- `bun test` — тесты (логика auth-писем, отправка почты, инструменты Kate).
  Файлы `*.test.ts` исключены из tsc: глобальные типы Bun конфликтуют с
  DOM-типами приложения.
- `bun run lint` — 0 ошибок (остаются 5 предупреждений react-refresh в
  shadcn-файлах); держать так. `eslint-disable` и `as any` в коде страниц нет —
  не добавлять. Форматирование и содержательные правки — разными коммитами.

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

Supabase — **self-hosted в Coolify** (с 2026-10-07): API
`https://api.base40.fit`, публичный ключ — anon в JWT-формате (`eyJ...`, в `.env`
под прежним именем `VITE_SUPABASE_PUBLISHABLE_KEY`); `APP_SUPABASE_SERVICE_KEY` —
service*role JWT этого же инстанса. Облачный проект `lyvarbqquvgxufmqgyix` не
используется. Настройки Auth (redirect URLs, Send Email Hook, лимиты) —
переменные `GOTRUE*\*` сервиса auth в Coolify; SQL — через Studio. Edge Functions нет.

## Auth-письма

Send Email Hook (`GOTRUE_HOOK_SEND_EMAIL_*` у сервиса auth): Supabase дёргает /api/auth-email (src/routes/api/auth-email.ts),
логика писем — src/lib/auth-email.ts (+ тест auth-email.test.ts), отправка —
src/lib/mail.ts с noreply@base40.fit: через Unisender Go, если задан
UNISENDER_GO_API_KEY, иначе по-старому Resend (код Resend удалим отдельным
шагом после переключения ключа).

**Разделение по ПРИЛОЖЕНИЮ, а не по человеку**: админка и клиентское
приложение — разные сущности, один человек может быть и админом, и клиентом.
Признак — хост в redirect_to (оба приложения задают emailRedirectTo явно):
admin.base40.fit -> ссылка авто-входа, всё остальное (включая нераспознанный
redirect) -> 6-значный код. Env: SEND_EMAIL_HOOK_SECRET, UNISENDER_GO_API_KEY (или RESEND_API_KEY),
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
  только сотрудник (`db/storage_hardening.sql`); бакет `avatars` пишется в свою
  папку `{uid}/`. **Прогнать оба файла в SQL Editor (см. AGENT_TASKS.md,
  Задача 0).**
- SECURITY DEFINER-функции, выданные `authenticated`, обходят RLS — обязаны
  сами проверять вызывающего (`auth.uid()` — владелец записи или `is_trainer`).
  Серверные роуты админки (chat/transcribe) — только для сотрудников через
  `authenticateStaff` (`src/lib/staff-auth.server.ts`), серверные функции —
  через middleware `requireStaff`/`requireOwner`
  (`src/integrations/supabase/auth-middleware.ts`). Service-ключ
  (`getSupabaseAdmin`) — только после такой проверки и только для того, что
  RLS не позволяет (`auth.admin.*`).
- **⚠️ Предрелизный риск (оплата): покупка абонемента клиентом — сейчас
  МУЛЯЖ без оплаты.** `handlePurchase` в клиенте вставляет строку в `sales`
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

## Код

- Клиент Supabase в браузере НЕтипизированный (без `<Database>`); свежие типы
  генерировать пока нечем — нужен access token владельца.
- Стиль: русские тексты UI, `@/` алиасы. Иконки — **Hugeicons** под именами
  lucide: alias в `vite.config` + `paths` в `tsconfig` подменяют
  `lucide-react` на шим `src/lib/icons.tsx` (сам пакет `lucide-react` из
  зависимостей убран). Шим генерируется — `bun run scripts/gen-icons.ts`
  пересобирает его по фактическим импортам; ручные соответствия имён лежат
  в `MANUAL` там же.
- Файлы страниц в `src/routes/_authenticated/` — самодостаточные (запросы,
  диалоги и таблица в одном файле); при доработке сохраняй этот стиль.
  Исключение — разделы одной сущности в разных таблицах: «Новости» и
  «Услуги» — общая `components/showcase-page.tsx`, файлы роутов — конфиг.
  Эталон страницы — `promocodes.tsx`.

### Слой данных (React Query)

- Загрузка — `useQuery` + `unwrap()` из `src/lib/query.ts` (ошибка Supabase →
  исключение). Текст ошибки — `meta: { errorMessage: "Не удалось загрузить …" }`,
  тост показывает общий QueryCache — свой `toast.error` на загрузку не писать.
- queryKey: `[таблица, studioId, ...параметры]`. После записи —
  `invalidateQueries({ queryKey: [таблица] })`; локальная правка без
  рефетча — `setQueryData`. Кнопка «Обновить» в шапке инвалидирует весь кэш —
  отдельной «шины обновления» нет.
- Серверная пагинация — `useServerTable` (`src/hooks/use-server-table.ts`):
  все фильтры в queryKey (строками, не объектами), смена фильтра сама
  возвращает на 1-ю страницу; подвал — `<DataPagination {...table.pagination} />`.
  Клиентская пагинация небольших списков — `usePagination`. Поиск —
  `useDebouncedValue` + `sanitizeSearch`.
- Студия — `useActiveStudioId()` (`src/hooks/use-active-studio.ts`), заглушка
  без студии — `<RequireStudio>`. Текущий сотрудник — `useStaffProfile()`;
  для записи в БД — `await ensure()` (иначе ранний клик пишет null).
- Диалог с формой: состояние формы — в дочернем компоненте внутри
  `<DialogContent>` с `key={item?.id ?? "new"}`, инициализация через
  `useState(item?.x ?? "")`. Эффекты «сбросить поля при открытии» не писать:
  Radix размонтирует содержимое при закрытии. Сначала валидация, потом
  `setSaving(true)`, снятие — в `finally`. Удаление — `useConfirm`.

### Общие модули

- `src/lib/format.ts` — деньги (`formatMoney` без копеек, `formatMoneyPrecise`),
  даты (`formatDate`, `formatDateTime`, `todayISO` — локальная дата, НЕ
  `toISOString()`), `clientName` («Фамилия Имя»), `initials`, `genderLabel`.
- `src/lib/payments.ts`, `src/lib/bookings.ts` (+ `BookingStatusBadge`),
  `src/lib/client-status.ts`, `src/lib/workout-types.ts` — справочники.
- `src/lib/storage.ts` + `components/image-upload-field.tsx` — картинки
  Storage (`StorageImage`, `ImageUploadField`); бакеты — `STORAGE_BUCKETS`.
- `components/client-combobox.tsx` — выбор клиента (серверный поиск);
  `ClientNameLink` + `hooks/use-crm-links.ts` — имя клиента со ссылкой amoCRM
  (ссылки для таблицы — одним запросом на страницу).
- `src/lib/roles.ts` — `STAFF_ROLES`, `hasStaffRole`.

### Сервер

- Параметры Supabase читаются только в `src/integrations/supabase/env.ts`;
  клиенты на сервере — `createUserClient(token)` (RLS действует) и
  `getSupabaseAdmin()` (service-ключ) из `client.server.ts`.
- Модули `*.server.ts` в клиентский бандл не попадают — сборка падает
  (importProtection в vite.config). Серверное — только в таких файлах или в
  обработчиках `createServerFn`/API-роутов.
- AI-ассистент: роут `src/routes/api/chat.ts`, инструменты/промпт/даты —
  `src/lib/assistant/`. Даты «сегодня» и границы суток — по Тбилиси (сервер
  в UTC).

## Известные недоработки (найдены при рефакторинге 2026-10-09, не исправлены)

Нужна миграция БД:

- Удаление занятия каскадом удаляет `schedule_bookings`, а строки `bookings_log`
  остаются `booked` — потом `mark_no_show_bookings` делает их `no_show`. Нужен
  триггер before delete на `schedule_entries` (перевести журнал в `cancelled`)
  или удаление через RPC.
- `handle_new_user` (client_app_fixes.sql) заводит карточку `clients` каждому
  новому пользователю — и сотрудникам, созданным в «Доступах»: в списке
  клиентов появляются сотрудники.
- Во вью `sales_list` и `bookings_log_full` нет `crm_link` — ссылки amoCRM
  догружаются отдельным запросом на страницу (`useCrmLinks`).
- `visits_left` не уменьшается ни одной функцией в db/\*.sql — проверить на
  живой базе, расходуются ли пакеты посещений.
- Перестановка порядка новостей/услуг — три отдельных update (неатомарно);
  строки с одинаковой `position` не переставляются. Нужна RPC.

Решение владельца:

- Промокод в продаже — свободный текст: не проверяется по `promo_codes`,
  `usage_count` не растёт.
- «Отправить» пуш только ставит `status='sent'`, реальной рассылки нет.
- «Активные клиенты» на дашборде не считают замороженные абонементы, а
  статус ЧК считает.
- «История записей» и «Отмены автопродления» показывают «Имя Фамилия»
  (full_name в приоритете), остальные разделы — «Фамилия Имя».
- У новостей кнопку можно заполнить наполовину, у услуг — нет.
- Фото тренеров и тренировок открываются по подписанным ссылкам, хотя бакеты в
  db/ публичные; если в живой базе тоже публичные — перевести на `public` в
  `STORAGE_BUCKETS`.

## Документы

- `AGENT_TASKS.md` — **актуальный список задач браузерному агенту** (ручные
  шаги в веб-панелях: миграции, ключи, хуки). Держать в актуальном состоянии.
- `MIGRATION.md` — план и статус переезда с Lovable
- `INFRA_SETUP.md` — инструкция браузерному агенту (инфраструктура, шаг 9 —
  отключение Lovable)
