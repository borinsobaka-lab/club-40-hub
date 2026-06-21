# Активные абонементы и продажи из мобильного приложения

## Что меняется в схеме БД (SQL)

Новый файл `db/client_memberships.sql` плюс правки в `db/sales.sql`.

### 1. `public.sales` — источник продажи
```
alter table public.sales
  add column if not exists source text not null default 'admin'
    check (source in ('admin','mobile'));
```
`admin` — продажа вручную на портале (может быть с рассрочкой).
`mobile` — оплата из мобильного приложения (всегда полная, `remaining_installments = 0`).

### 2. `public.client_memberships` — активный абонемент клиента
```
create table public.client_memberships (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  source text not null default 'admin' check (source in ('admin','mobile')),
  started_at date not null default current_date,
  ends_at date,                 -- null = бессрочно
  visits_left int,              -- null = безлимит
  status text not null default 'active' check (status in ('active','replaced','expired','cancelled')),
  created_at timestamptz not null default now()
);
```
Уникальный частичный индекс — гарантирует один активный абонемент на клиента:
```
create unique index client_memberships_one_active
  on public.client_memberships(client_id) where status = 'active';
```
GRANT + RLS как у `sales` (по `is_trainer` и `current_studio_id`).

### 3. Триггер автосоздания активного абонемента при `INSERT INTO sales`
Серверная функция `public.activate_membership_from_sale()` (SECURITY DEFINER):
- если у клиента уже есть `active` — переводит его в `replaced`;
- считает `ends_at = sold_at + memberships.duration_days`;
- `visits_left = memberships.visits_count` (или NULL = безлимит);
- вставляет новую строку `active` с `source = NEW.source`.

Это покрывает оба сценария — и портал, и мобильное приложение (мобильное просто вставит `sales` с `source='mobile'`).

## Что меняется в портале

### `src/routes/_authenticated/sales.tsx`
- Колонка «Источник» (badge: «Портал» / «Приложение»).
- В `SaleDialog`:
  - Поле `source` фиксировано `admin` (не выбирается).
  - Перед сохранением — проверка: если у клиента уже есть активный абонемент, показать модалку-подтверждение «У клиента уже есть активный абонемент «X». Новая продажа заменит его. Продолжить?». При подтверждении продажа создаётся, триггер сам переведёт старый в `replaced`.
  - Рассрочка остаётся только для `admin`-продаж.

### `src/components/client-card-dialog.tsx`
- Новый блок «Активный абонемент» сверху, над историей продаж:
  - Название, источник, `started_at → ends_at`, «осталось посещений: N / безлимит».
  - Кнопка «Редактировать» — открывает `EditActiveMembershipDialog` (новый компонент): поля `ends_at` (date) и `visits_left` (number или «безлимит»). Сохраняет `update client_memberships`.
  - Если активного нет — пометка «Нет активного абонемента».
- История продаж получает бейдж источника возле даты.

### Новый компонент `src/components/edit-active-membership-dialog.tsx`
Простой Dialog с двумя полями + сохранение в `client_memberships`.

## Инструкция для мобильной разработки

При успешной оплате абонемента мобильное приложение делает один insert:
```
insert into sales (
  studio_id, client_id, membership_id,
  sold_at, total_amount,
  down_payment_amount, remaining_installments,
  source
) values (
  :studio_id, :client_id, :membership_id,
  current_date, :price,
  :price, 0,
  'mobile'
);
```
Триггер сам:
- создаст/перепишет `client_memberships` (активный),
- проставит срок и оставшиеся посещения по выбранной номенклатуре.

Перед покупкой клиент в приложении должен получать ошибку, если уже есть активный абонемент. Простой запрос:
```
select id, membership_id, ends_at, visits_left
from client_memberships
where client_id = :client_id and status = 'active'
limit 1;
```
Если строка есть — покупка из приложения запрещена (на портале админ может «перебить»).

## Проверка после внедрения
1. Создать продажу на портале → у клиента появляется активный абонемент с верными датой/посещениями.
2. Создать вторую продажу → диалог-подтверждение, старый абонемент `replaced`, новый `active`.
3. В карточке клиента отредактировать срок/посещения — сохраняется в `client_memberships`.
4. Эмуляция мобильной покупки: `insert into sales (..., source='mobile')` через SQL → активный абонемент создаётся без рассрочки, в списке продаж видна как «Приложение».
