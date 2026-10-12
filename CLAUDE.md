# Base40 — монорепозиторий: админка + клиентское приложение

Фитнес-студия Base40: два продукта на одной базе Supabase. Оба — TanStack
Start (SSR) + React 19 + Tailwind 4 + shadcn/radix, пакетный менеджер — bun.

## Структура

- `apps/admin/` — админ-панель, https://admin.base40.fit. Свой **CLAUDE.md**
  (код, слой данных, auth-письма, сервер) — читать перед правками в админке.
- `apps/client/` — клиентское приложение: https://app.base40.fit
  (подписочный формат) и app.lady-stretch.one (пакетный, `VITE_APP_FORMAT=packages`)
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
(держать актуальным). Студии заводятся в разделе «Клубы» админки (рейка слева
от меню): тип, логотип в меню, основной цвет (`--brand` админки при открытой
студии).

**Термин в интерфейсе админки — «клуб», не «студия»** (решение владельца
2026-10-11): все тексты админки (подписи, подсказки, ошибки, в том числе
ошибки RPC — `db/migrations/2026-10-11_club_term_messages.sql`, описания
инструментов Kate) пишутся с «клуб» в нужном роде и падеже («Клуб создан»,
«в каждом клубе»). В коде, схеме и документах остаются `studio`/«студия».
В «Скриптах LS» переменная — `{клуб}`; прежняя `{студия}` в старых текстах
подставляется так же. Клиентское приложение этим решением не затронуто.

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

| Ресурс Coolify           | Адрес                        | Dockerfile                | Watch Paths              |
| ------------------------ | ---------------------------- | ------------------------- | ------------------------ |
| `club40-admin`           | https://admin.base40.fit     | `/apps/admin/Dockerfile`  | `apps/admin/**`, `db/**` |
| `club40-client`          | https://app.base40.fit       | `/apps/client/Dockerfile` | `apps/client/**`         |
| `club40-client-packages` | https://app.lady-stretch.one | `/apps/client/Dockerfile` | `apps/client/**`         |

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

**Сотрудник и клиент на одной почте — независимо** (решение владельца
2026-10-12). Учётная запись GoTrue на почту одна, но у неё две части:
служебная (роли owner/admin/trainer, «Доступы», `profiles` — имя, аватарка,
студия админки) и клиентская (карточка `clients`, анкета, записи, оценки).
Клиентская сторона служебную не трогает: студия клиента для RLS —
студия карточки (`current_studio_id`), профиль сотрудника не переписывается;
удаление карточки клиента у сотрудника стирает только клиентскую часть;
снятие доступа не удаляет учётную запись клиента; выход — `signOut({ scope:
"local" })` в обоих приложениях (глобальный отозвал бы сессии и во втором).
Схема — `db/migrations/2026-10-12_zzz_staff_client_separation.sql`. Общий
остаётся только код входа: новый код, запрошенный в одном приложении,
отменяет неиспользованный код другого.

## База данных

- Удаление занятия: `db/migrations/2026-10-10_schedule_entry_delete.sql` —
  журнал записей удалённого занятия переводится в «Отменено» (раньше оставался
  «Забронировано», а потом превращался в пропуски клиентов); там же разовое
  исправление истории. Сотрудники: `db/migrations/2026-10-10_staff_accounts.sql`
  — без паролей, без карточек клиентов (актуальный `handle_new_user` —
  `2026-10-11_zzzzzzzzz_client_signin_only.sql`; `db/client_app_fixes.sql`
  вручную не перезапускать — вернёт регистрацию без карточки).
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
  их таблицы общие, граница там по-прежнему студия. Мобильное приложение — по
  студиям (решение владельца 2026-10-11, отменило «общее для студий» из
  `2026-10-10_app_content_shared.sql`):
  `db/migrations/2026-10-11_zzzzzzzzzz_app_content_by_studio.sql` —
  `news`/`services`/`push_notifications.studio_ids uuid[]` (старым записям —
  все студии; `studio_id` больше не используется); сотрудник видит и правит
  запись, где есть хоть одна его студия, добавляет и убирает только свои
  (триггер `app_content_studios_guard`), удаляет — только если все студии
  его; хелперы `staff_has_all_studios`/`staff_has_any_studio`; удалённая
  студия уходит из списков, запись без студий удаляется. «Контакты и
  правила» — `studio_app_settings` (строка на студию, заполнена из
  `club_settings`); иконка и подпись PWA — `app_install_settings` (строка на
  формат = приложение). Обе читаются публично.
  «Скрипты LS» (скрипты администраторов Lady Stretch, перенос из
  «Аудиоаналитики»): `db/migrations/2026-10-10_scripts_ls.sql` — таблицы
  `scripts_*` без studio_id (раздел общий для студий), доступ — разделы рейки
  `scripts` / `scripts-edit` в `admin_permissions` (`has_admin_section`);
  подписи и хронологию пишут триггеры, статистика — RPC `scripts_copy_stats` /
  `scripts_call_stats`, импорт — `scripts_import`.
  Номенклатура пакетных студий: `db/migrations/2026-10-10_packages_memberships.sql`
  — триггер, выключающий автопродление в пакетных студиях (добавленный там
  `for_regular_clients` убран `2026-10-11_packages_no_regular_price.sql`).
  Рассрочка пакетных студий: `db/migrations/2026-10-11_packages_installments.sql`
  — `memberships.max_payments` (сколькими платежами можно оплатить, 1–12),
  `sales.remaining_installments` расширен до 0–11 (подписочные 0/2/3 — как
  были).
  Типы номенклатуры и продаж пакетных студий:
  `db/migrations/2026-10-11_packages_sale_kinds.sql` — `memberships.kind`
  (`package` / `trial`), `sales.sale_kind` (`new` / `trial` / `upsell` /
  `renewal`, null — без типа); там же пересоздана вью `sales_list` (актуальное
  определение — в этой миграции, не в `db/performance_indexes.sql`).
  Раздел «Абонементы» пакетных студий:
  `db/migrations/2026-10-11_packages_client_memberships.sql` —
  `sales.trainer_id`/`trainer_name` (тренер при продаже, бонус к зарплате),
  `sales.membership_note` (комментарий раздела), `sale_installments.paid_at`
  (дата внесения, ставит триггер), вью `client_packages_list` (строки раздела,
  платежи json и `payment_state` paid/overdue/pending по дате Тбилиси); там же
  снова пересоздана `sales_list` (актуальное определение — в этой миграции).
  Баланс и списание пакетных студий:
  `db/migrations/2026-10-11_zz_packages_personal_balance.sql` — третий тип
  номенклатуры `personal`, `memberships.personal_count`,
  `client_memberships.personal_left`/`balance_kind` (один живой абонемент на
  клиента и вид баланса, `activate_membership_from_sale` переопределена),
  списание при `attended` — триггер на `schedule_bookings`
  (`charged_membership_id`), состояние `soon` в `client_packages_list`
  (актуальное определение вью — в этой миграции).
  Продление пакетных студий: `db/migrations/2026-10-11_zzz_packages_renewal_queue.sql`
  — `client_memberships.status = 'pending'` и `starts_on_first_visit` (срок от
  первого посещения, `started_at` может быть null), очередь — `packages_settle`
  (по виду баланса); переопределены `activate_membership_from_sale` и
  `schedule_bookings_charge_balance` (из `zz_packages_personal_balance`),
  `sale_installments.payment_method`; вью `client_packages_list` пересоздана
  (актуальное определение — здесь).
  Отмена посещения и бонус: `db/migrations/2026-10-11_zzzzz_attendance_undo_personal_bonus.sql`
  — RPC `unmark_booking_attended` (attended → booked, тренировку возвращает
  триггер списания), `payroll_lines` — пакет персональных не идёт в продажи
  администратора. `db/migrations/2026-10-11_zzzzzz_personal_no_trainer_bonus.sql`
  — и тренера при продаже (актуальное определение `payroll_lines` — здесь).
  Удаление продажи абонемента (оба формата):
  `db/migrations/2026-10-11_zzzzzz_sale_membership_delete.sql` — продажа и
  выданный по ней `client_memberships` удаляются вместе (в обе стороны,
  триггеры), прежний заменённый абонемент возвращается, очередь продлений —
  `packages_settle`.
  Отмена занятия, «Не посетил», второй телефон:
  `db/migrations/2026-10-11_zzzzzzz_entry_cancel_no_show.sql` —
  `schedule_entries.cancelled_at`/`cancel_reason`, RPC `cancel_schedule_entry`
  (записи → «Отменено», списанное возвращается) и `restore_schedule_entry`,
  на отменённое не записывают (триггер), клиенты его не видят (RLS), в
  зарплату не идёт (`payroll_lines` — актуальное определение здесь);
  `schedule_bookings.no_show_excused`/`no_show_comment`, RPC
  `mark_booking_no_show` — неуважительный пропуск списывается как посещение
  (`schedule_bookings_charge_balance` и `packages_restart_term` переопределены
  здесь), пропуск без причины — нет; `clients.phone2` (вью
  `clients_with_status` пересоздана здесь).
  Исправления по код-ревью: `db/migrations/2026-10-11_zzzzzzzz_review_fixes.sql`
  — итоговые политики реквизитов/ставок (`can_manage_employee`), сотрудников,
  новостей/услуг/пушей и `schedule_bookings_group_only` (на чистой базе
  раньше побеждали версии из файлов, идущих позже по имени); удалённая запись
  возвращает списанное и место (триггер `schedule_bookings_refund_ad`); запись
  только в пределах студии; клиент не отменяет запись после начала занятия;
  «Не посетил» не перезаписывается повторной записью; `book_schedule_entry` —
  пусто/0 мест = без лимита; покупка в приложении не пишет продавца, тренера,
  тип и дату (`sales_client_insert_guard`); ждущее продление не списывается
  при живом абонементе того же вида, перенос начала срока сохраняет заморозку
  (актуальные `schedule_bookings_charge_balance`, `packages_restart_term`,
  `packages_settle` — здесь). Порядок файлов = порядок имён: новый файл,
  читающий колонки другого, должен идти по имени ПОСЛЕ него.
  Вход в клиентское приложение без регистрации:
  `db/migrations/2026-10-11_zzzzzzzzz_client_signin_only.sql` —
  `handle_new_user` создаёт учётную запись клиента только по карточке
  `clients` с той же почтой (иначе исключение, GoTrue не создаёт
  пользователя), сотрудники из «Доступов» — как прежде;
  `ensure_client_profile` ищет карточку по почте во всех студиях (актуальные
  определения обеих функций — здесь).
  Учётные записи приложения: `db/migrations/2026-10-12_client_account_wipe.sql`
  — `ensure_client_profile` больше не заводит карточку (нет карточки с этой
  почтой — исключение `not_a_club_member`, приложение выходит; актуальное
  определение — здесь), хук писем не шлёт код входа в клиентское приложение
  без карточки (`client_app_sign_in_allowed`, только service_role);
  удаление карточки клиента (триггер `clients_wipe_account_ad`) стирает её
  журнал записей и, если других карточек нет, учётную запись
  (`wipe_client_app_account`: анкета, оценки, записи без карточки, сам
  пользователь GoTrue; у сотрудника — только клиентская часть). Разово
  стёрты «фантомные» учётные записи — входили, но карточки нет; клиентов с
  карточкой (продажи, абонементы, анкета) очистка не трогала.
  Разделение сотрудника и клиента:
  `db/migrations/2026-10-12_zzz_staff_client_separation.sql` —
  `current_studio_id` берёт студию карточки клиента (без карточки — профиля);
  `sync_profile_studio` и `ensure_client_profile` не трогают профиль
  сотрудника (актуальное определение `ensure_client_profile` — здесь);
  триггер `user_roles_staff_home_studio` держит `profiles.studio_id`
  сотрудника в студии, где он сотрудник; `clients_guard_self_update` (актуальное
  определение — здесь) разрешает привязать свободную карточку со своей
  почтой — раньше `ensure_client_profile` молча не привязывал её никому, кроме
  сотрудников студии.
  **Полная очистка клиентской базы 2026-10-12:**
  `db/migrations/2026-10-12_zzzz_clients_full_reset.sql` (разово, вручную не
  перезапускать) — во всех студиях стёрты клиенты, абонементы, продажи (с
  рассрочкой, прочими продажами и возвратами), записи и их история, анкеты,
  оценки тренеров клиентами, обратная связь, NPS, аватарки клиентов, роли
  `member` и все учётные записи, кроме сотрудников. Студии, сотрудники,
  расписание, номенклатура, касса, контент приложения остались.
  Правки приложения пакетов 2026-10-12:
  `db/migrations/2026-10-12_zz_packages_app_fixes.sql` — `memberships.tag_text`
  / `tag_style` (`soft` / `bright`) / `gift_text` (тег и «В подарок» в
  карточке пакета); политики папки клиента `{uid}/` в бакете `avatars` и
  «clients self update» (на self-hosted их не было — `db/storage_avatars.sql`
  с невалидным `create policy if not exists`); калории — триггер
  `schedule_bookings_log_kcal_aiu` при переходе записи в `attended` (не
  зависит от версии `mark_booking_attended`) и `member_profiles_fill_calories_aiu`
  (вес указан позже — досчитывает посещения без снимка),
  `bookings_log_fill_calories` переопределена здесь; RPC
  `my_studio_visit_stats` — сравнение со студией в статистике приложения;
  `refresh_client_stats_30d` — только service_role.
  Онбординг пакетного приложения: `db/migrations/2026-10-11_packages_onboarding.sql`
  — `member_profiles.goal_other` (текст цели «Другое»), `birth_date`, новые
  значения enum `fitness_goal` (`flexibility`/`stress_relief`/`body_shape`/`other`).
  История веса клиента: `db/migrations/2026-10-12_zzzzz_client_weights.sql` —
  `client_weights` (user_id, `weight_kg`, `measured_at`, `source`
  `onboarding`/`manual`; клиент ведёт свою, сотрудник студии читает); вес из
  анкеты — одна запись `onboarding` датой отправки (уже пройденные анкеты
  перенесены), дальше — раздел взвешиваний (`manual`).
  Цвет тренировки (пакетный формат, полоска в расписании):
  `db/migrations/2026-10-11_workout_color.sql` — `workouts.color`.
  Типы занятий в расписании (оба формата):
  `db/migrations/2026-10-11_schedule_activity_kinds.sql` —
  `schedule_entries.kind` (`group` / `personal` / `other`), `title` и
  `pay_rate` прочей активности, `workout_id` только у групповых; клиенты видят
  и записываются только на групповые (RLS + триггер на `schedule_bookings`).
  Запись по карточке клиента: `db/migrations/2026-10-11_bookings_by_client.sql`
  — `schedule_bookings.client_id` (user_id необязателен: клиент без
  приложения), user_id/client_id дополняют друг друга триггером, при привязке
  карточки к приложению записи получают user_id; журнал — `bookings_log.client_id`;
  администратор записывает RPC `admin_book_client` (групповое и персональное,
  проверка мест); персональное — только сотрудник, прочая активность — никто.
  Старые функции журнала не переписаны (неизвестно, какие db/\*.sql на живой
  базе), рядом — свои триггеры.
  Зарплаты пакетных студий (раздел «Сотрудники»):
  `db/migrations/2026-10-11_zzz_staff_payroll.sql` — `admin_shifts` (график
  администраторов по студиям), `payroll_adjustments` (вычеты/надбавки),
  `payroll_payouts` (отметка «выплачено» за половину месяца), расчёт — RPC
  `payroll_lines` (security definer: оклад общий по всем пакетным студиям
  сотрудника, отдаёт только сотрудников студий вызывающего). Доступ — раздел
  рейки `staff` + роль в студии сотрудника (`can_manage_employee`).
  Продавец в продажах: `db/migrations/2026-10-11_zzzz_sales_seller.sql` —
  `sales.seller_id` / `other_sales.seller_id` (администратор из справочника,
  выбирается в форме; `admin_name` — снимок имени, `admin_id` — кто внёс);
  `trainers.user_id` и `staff_accounts_for_link` удалены; `payroll_lines`
  переопределена (актуальное определение — здесь): продажи в зарплату —
  поступившие за период платежи (`sale_installments.paid_at`, без графика —
  вся сумма в день продажи).
  Аватарки сотрудников админки: `db/migrations/2026-10-11_staff_avatars.sql`
  — `profiles.avatar_url` (путь в бакете `avatars`, папка `staff/`, ставит
  владелец в «Доступах» серверной функцией).
  Установка клиентского приложения (PWA):
  `db/migrations/2026-10-11_app_install_settings.sql` — бакет `app-icons`
  (папки с нарезанными PNG, запись — раздел рейки `app`) и колонки
  `club_settings.app_name`/`app_icon_path` — с `…_app_content_by_studio.sql`
  не читаются, настройки в `app_install_settings` (у каждого приложения свои).
  Приложение пакетных студий (правки 2026-10-11):
  `db/migrations/2026-10-11_zzzzzzzzzzz_packages_app_studio.sql` —
  `studio_app_settings.about/photo_path/google_maps_url/yandex_maps_url/instagram_url`
  (раздел «Студия» в приложении, бакет `studio-photos`), `trainers.bio`,
  `memberships.sort_order` (порядок в админке и приложении), политики
  `… client browse` + `client_can_browse_studio`: клиент читает расписание,
  тренировки, тренеров и показываемые абонементы другой студии того же
  формата (переключатель студий; записаться — только в своей).
  Рейтинг тренеров и чаевые: `db/migrations/2026-10-11_zzzzzzzzzzzzz_trainer_ratings.sql`
  — `trainer_reviews` (оценка 1–5, одна от учётной записи на тренера; клиент
  читает и правит свою, ставит — тренеру, которого видит в приложении,
  `client_can_rate_trainer`), `trainers.rating_base_avg/rating_base_count`
  (прежний сервис), итог `trainers.rating_avg/rating_count` — считает
  триггер `trainers_rating_calc` при любой записи строки (руками не пишется),
  `trainers.tip_url` (ссылка на чаевые).
  Адрес студии: `db/migrations/2026-10-11_zzzzzzzzzzzz_studio_address.sql` —
  `studios.address` (публичное чтение колонки, правит владелец; плашка
  студии в приложении пакетов).
  Мессенджеры студии: `db/migrations/2026-10-12_studio_messengers.sql` —
  `studio_app_settings.whatsapp_url/messenger_url` («Контакты и правила» →
  «О клубе»; в приложении пакетов — «Студия» → «Информация»).
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
  `sales_list`, `cash_totals`, `bookings_log_full` (db/performance_indexes.sql;
  `sales_list` пересоздана в `2026-10-11_packages_client_memberships.sql`), все с
  `security_invoker = true` — RLS действует. `s.*` во вью раскрывается при её
  создании: новая колонка `sales` попадёт в `sales_list` только после
  пересоздания вью (последнее — `2026-10-11_packages_client_memberships.sql`).
- **Модель доступа: граница безопасности — RLS, не фронтенд.** Publishable-ключ
  вшит в бандл, любой может дёргать PostgREST напрямую. Guard'ы роутов —
  только UX. Все клиентские таблицы читаются по принципу «своя строка или
  сотрудник» (`is_trainer`/`has_role`); витринные `news`/`services`/
  `club_settings`/`studio_app_settings`/`app_install_settings` — публичны
  намеренно. Каждый новый пользователь получает роль
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
- `AUTH_SETUP.md` — настройка почтовой авторизации (хук писем, Resend).
- `apps/client/DEPLOY.md` — деплой клиентских приложений в Coolify.
- `MIGRATION.md` — план и статус переезда с Lovable
- `INFRA_SETUP.md` — инструкция браузерному агенту (инфраструктура, шаг 9 —
  отключение Lovable)
