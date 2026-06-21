## 1. Карточка клиента в разделе «Клиенты»

- В таблице `/clients` ФИО становится подчёркнутой ссылкой.
- По клику открывается модальная карточка клиента (`ClientCardDialog`) — read-only вид: фото, ФИО, телефон/email, пол, дата рождения, регистрация, последний визит, CRM-ссылка, заметки + блок «Абонементы клиента» (список покупок из новой таблицы `sales`) и «История продаж».
- В шапке карточки — кнопки «Редактировать» (открывает существующий `ClientDialog`) и «Закрыть».

## 2. Новый раздел «Продажи» (`/sales`)

Сайдбар → группа «Финансы» → пункт «Продажи» (иконка `Receipt`), рядом с «Кассой».

### Страница `/sales`
- Таблица продаж студии с пагинацией (`DataPagination`, как везде).
- Колонки: Дата · Клиент (ссылка на карточку) · Абонемент · Сумма · Первый взнос · Рассрочка · Администратор · Комментарий · действия (удалить).
  - Если у абонемента не включена рассрочка — в колонках «Первый взнос» и «Рассрочка» ставится «—».
- Поиск по клиенту/абонементу, кнопка «Новая продажа».

### Диалог «Новая продажа»
- **Клиент** — `Combobox` с поиском по уже созданным клиентам студии.
- **Дата продажи** — `date`-инпут, по умолчанию сегодня.
- **Абонемент** — `Combobox` с поиском по `memberships` студии.
- **Стоимость** — авто-подставляется из выбранного абонемента, можно перебить вручную.
- **Администратор** — предзаполнено именем текущего пользователя (read-only текст + скрытый id).
- **Рассрочка** — показывается только если у выбранного абонемента `installment_enabled = true`:
  - Поле **Первый взнос**, ₽.
  - Выбор **Ещё платежей** — 2 или 3 месяца.
  - Превью графика: первый взнос сегодня + оставшиеся платежи через 1, 2 (или 3) месяца. Оставшаяся сумма (`total − первый взнос`) делится поровну, последний платеж добирает остаток до копейки.
- Если рассрочка у абонемента **не доступна**, поля рассрочки скрыты, а `down_payment_amount = total_amount`, `remaining_installments = 0`.
- **Комментарий** — `Textarea`, необязательный.
- Кнопка «Сохранить» создаёт запись в `sales` и строки в `sale_installments` (первый взнос с `paid = true`, остальные с `paid = false`).

## 3. База данных — новая миграция `db/sales.sql`

```sql
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  admin_id uuid references auth.users(id) on delete set null,
  admin_name text,
  sold_at date not null default current_date,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  down_payment_amount numeric(12,2) not null default 0 check (down_payment_amount >= 0 and down_payment_amount <= total_amount),
  remaining_installments smallint not null default 0 check (remaining_installments in (0,2,3)),
  comment text,
  created_at timestamptz not null default now()
);

create table public.sale_installments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
```

- В `db/memberships.sql` добавить `installment_enabled boolean not null default false`.
- GRANT'ы для `authenticated` / `service_role`.
- RLS: SELECT/INSERT/UPDATE/DELETE — `public.is_trainer(auth.uid(), studio_id)`; для `sale_installments` — через `exists (select 1 from sales s where s.id = sale_id and is_trainer(...))`.
- Индексы: `sales(studio_id, sold_at desc)`, `sales(client_id)`, `sale_installments(sale_id)`.
- `notify pgrst, 'reload schema';`

## 4. Что НЕ трогаю в этом шаге

- Касса (`cash_operations`) — отдельная сущность, продажи туда автоматически не пишем (если нужно — отдельной задачей).
- Реальная оплата / `purchase_membership` RPC и `user_memberships` (это следующий шаг, как договорились — после того как продажи живут отдельно). Если хочешь, могу сразу синхронизировать продажу с выдачей абонемента клиенту — скажи.

## Файлы

- new `db/sales.sql`
- new `src/routes/_authenticated/sales.tsx`
- new `src/components/client-card-dialog.tsx` (вынесу карточку клиента, чтобы переиспользовать из `clients.tsx` и `sales.tsx`)
- edit `src/routes/_authenticated/clients.tsx` — ФИО как кнопка-ссылка → открывает карточку
- edit `src/components/app-sidebar.tsx` — пункт «Продажи»

Ок поехали?
