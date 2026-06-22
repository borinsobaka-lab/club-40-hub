## Проблема

Ошибка `new row violates row-level security policy for table "sales"` возникает потому, что у таблицы `public.sales` сейчас одна-единственная RLS-политика:

```sql
create policy "sales studio rw" on public.sales
  for all to authenticated
  using (public.is_trainer(auth.uid(), studio_id))
  with check (public.is_trainer(auth.uid(), studio_id));
```

Она разрешает читать/писать `sales` **только тренерам студии**. Когда мобильное приложение делает `insert` от имени обычного клиента (он не тренер), `WITH CHECK` не проходит — и Postgres возвращает ту самую ошибку. Я в прошлый раз написал «RLS уже настроен, клиент может вставлять sales от своего имени» — это было неверно, политику для клиента я не добавил. Извиняюсь.

В базе всё корректно структурно, не хватает только политики, которая разрешает клиенту вставить продажу для самого себя.

## Что сделаю

Добавлю миграцию `db/sales_client_rls.sql`, которая:

1. Добавит INSERT-политику для клиента — он может вставить строку в `sales`, только если:
   - `client_id` действительно его (`exists (select 1 from clients c where c.id = sales.client_id and c.user_id = auth.uid())`),
   - `studio_id` совпадает со студией этого клиента,
   - `admin_id IS NULL` (поле `admin_id` остаётся для портала — клиент не должен подсовывать туда чужой uid),
   - `remaining_installments = 0` (рассрочку оформляет только администратор; клиент в приложении платит сразу).
2. Добавит SELECT-политику для клиента — он видит только свои продажи (`client_id` его).
3. Аналогично для `sale_installments` через EXISTS по `sales`.

Тренерскую политику `sales studio rw` не трогаю — она продолжает работать для портала.

## SQL, который нужно будет выполнить

```sql
-- SELECT собственных продаж для клиента мобильного приложения
drop policy if exists "sales client select own" on public.sales;
create policy "sales client select own" on public.sales
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = sales.client_id
        and c.user_id = auth.uid()
    )
  );

-- INSERT собственной покупки из мобильного приложения
drop policy if exists "sales client insert own" on public.sales;
create policy "sales client insert own" on public.sales
  for insert to authenticated
  with check (
    admin_id is null
    and remaining_installments = 0
    and exists (
      select 1 from public.clients c
      where c.id = sales.client_id
        and c.user_id = auth.uid()
        and c.studio_id = sales.studio_id
    )
  );

-- Те же права на sale_installments через родительский sale
drop policy if exists "sale_installments client select own" on public.sale_installments;
create policy "sale_installments client select own" on public.sale_installments
  for select to authenticated
  using (
    exists (
      select 1 from public.sales s
      join public.clients c on c.id = s.client_id
      where s.id = sale_installments.sale_id
        and c.user_id = auth.uid()
    )
  );
```

## Что сказать мобильному разработчику

- Схема та же, ничего в коде менять не нужно: всё тот же `insert` в `public.sales` со студией/клиентом/абонементом и `down_payment_amount = total_amount`, `remaining_installments = 0`, `admin_id = null`, `admin_name = null`.
- После выполнения миграции покупка пройдёт, и клиент сам сможет читать свои продажи через `select * from sales where client_id = <его client.id>`.

## После применения

Прогоним сквозной тест: покупка из мобильного → запись появилась в `sales` → видна на портале в разделе «Продажи».