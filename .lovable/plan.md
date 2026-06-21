## 1. Карточка клиента в разделе «Клиенты»

- В таблице `/clients` ФИО становится подчёркнутой ссылкой.
- По клику открывается модальная карточка клиента (`ClientCardDialog`) — read-only вид: фото, ФИО, телефон/email, пол, дата рождения, регистрация, последний визит, CRM-ссылка, заметки + блок «Абонементы клиента» (список покупок из новой таблицы `sales`) и «История продаж».
- В шапке карточки — кнопки «Редактировать» (открывает существующий `ClientDialog`) и «Закрыть».

## 2. Новый раздел «Продажи» (`/sales`)

Сайдбар → группа «Финансы» → пункт «Продажи» (иконка `Receipt`), рядом с «Кассой».

### Страница `/sales`
- Таблица продаж студии с пагинацией (`DataPagination`, как везде).
- Колонки: Дата · Клиент (ссылка на карточку) · Абонемент · Сумма · Рассрочка (1/2/3) · Администратор · Комментарий · действия (удалить).
- Поиск по клиенту/абонементу, кнопка «Новая продажа».

### Диалог «Новая продажа»
- **Клиент** — `Combobox` с поиском по уже созданным клиентам студии.
- **Дата продажи** — `date`-инпут, по умолчанию сегодня.
- **Абонемент** — `Combobox` с поиском по `memberships` студии.
- **Стоимость** — авто-подставляется из выбранного абонемента, можно перебить вручную.
- **Администратор** — предзаполнено именем текущего пользователя (read-only текст + скрытый id).
- **Рассрочка** — radio: «Сразу», «2 месяца», «3 месяца».
  - При выборе 2/3 показывается превью: список «дата → сумма» (равные части, первая — сегодня, далее +30/+60 дней; последняя часть добирает остаток до копейки).
- **Комментарий** — `Textarea`, необязательный.
- Кнопка «Сохранить» создаёт запись в `sales` и, при рассрочке, строки в `sale_installments`.

## 3. База данных — новая миграция `db/sales.sql`

```sql
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  admin_id uuid references auth.users(id) on delete set null,
  admin_name text,                    -- snapshot имени админа
  sold_at date not null default current_date,
  total_amount numeric(12,2) not null,
  installments smallint not null default 1 check (installments in (1,2,3)),
  comment text,
  created_at timestamptz not null default now()
);

create table public.sale_installments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  due_date date not null,
  amount numeric(12,2) not null,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
```

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
