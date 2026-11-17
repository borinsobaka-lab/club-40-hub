-- CRM: отчёт по воронке (CRM.md, «Отчёты»). security invoker — считает
-- только сделки и диалоги, которые видит вызывающий (RLS): администратор
-- клуба — свои клубы и сделки без клуба, crm.manage — всё.
--
-- crm_report(p_pipeline, p_from, p_to) → jsonb:
--   stages      — сейчас в этапах: [{stage_id, count, budget}] (открытые);
--   created     — создано сделок за период;
--   won / lost  — закрыто за период: {count, budget};
--   loss        — причины отказа: [{name, count}];
--   people      — по ответственным: [{user_id, open, won, won_budget, lost}];
--   sources     — по источникам: [{source, created, won}];
--   reply       — скорость первого ответа за период: {count, median_minutes}
--                 (первое сообщение клиента в диалоге → первый ответ
--                 сотрудника, без автоматических);
--   unanswered  — диалогов, где последнее слово за клиентом.
-- Период — по дате создания (created) и закрытия (won, lost), включительно.
create or replace function public.crm_report(p_pipeline uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select dl.*, s.kind as stage_kind
      from public.crm_deals dl
      join public.crm_stages s on s.id = dl.stage_id
     where dl.pipeline_id = p_pipeline
  ),
  closed as (
    select * from d
     where closed_at >= p_from::timestamptz and closed_at < (p_to + 1)::timestamptz
  ),
  made as (
    select * from d
     where created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz
  ),
  first_in as (
    select m.conversation_id, min(m.created_at) as at
      from public.crm_messages m
     where m.direction = 'in'
     group by m.conversation_id
    having min(m.created_at) >= p_from::timestamptz and min(m.created_at) < (p_to + 1)::timestamptz
  ),
  replies as (
    select f.conversation_id,
           (select min(m.created_at) from public.crm_messages m
             where m.conversation_id = f.conversation_id and m.direction = 'out'
               and not m.auto and m.status <> 'failed' and m.created_at >= f.at) - f.at as took
      from first_in f
  )
  select jsonb_build_object(
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'stage_id', x.stage_id, 'count', x.n, 'budget', x.budget))
      from (select stage_id, count(*) as n, coalesce(sum(budget), 0) as budget
              from d where closed_at is null group by stage_id) x), '[]'::jsonb),
    'created', (select count(*) from made),
    'won', (select jsonb_build_object('count', count(*), 'budget', coalesce(sum(budget), 0))
              from closed where stage_kind = 'won'),
    'lost', (select jsonb_build_object('count', count(*), 'budget', coalesce(sum(budget), 0))
               from closed where stage_kind = 'lost'),
    'loss', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n) order by x.n desc)
      from (select coalesce(r.name, 'Причина не указана') as name, count(*) as n
              from closed c left join public.crm_loss_reasons r on r.id = c.loss_reason_id
             where c.stage_kind = 'lost' group by 1) x), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', x.responsible_id, 'open', x.open, 'won', x.won,
        'won_budget', x.won_budget, 'lost', x.lost) order by x.won desc, x.open desc)
      from (select responsible_id,
                   count(*) filter (where closed_at is null) as open,
                   count(*) filter (where stage_kind = 'won' and closed_at >= p_from::timestamptz
                                      and closed_at < (p_to + 1)::timestamptz) as won,
                   coalesce(sum(budget) filter (where stage_kind = 'won' and closed_at >= p_from::timestamptz
                                      and closed_at < (p_to + 1)::timestamptz), 0) as won_budget,
                   count(*) filter (where stage_kind = 'lost' and closed_at >= p_from::timestamptz
                                      and closed_at < (p_to + 1)::timestamptz) as lost
              from d group by responsible_id) x
     where x.open + x.won + x.lost > 0), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'source', x.source, 'created', x.created, 'won', x.won) order by x.created desc)
      from (select coalesce(source, 'Не указан') as source, count(*) as created,
                   count(*) filter (where stage_kind = 'won') as won
              from made group by 1) x), '[]'::jsonb),
    'reply', (select jsonb_build_object(
        'count', count(*) filter (where took is not null),
        'median_minutes', round((extract(epoch from percentile_cont(0.5) within group (order by took)
                                   filter (where took is not null)) / 60)::numeric, 1))
      from replies),
    'unanswered', (select count(*) from public.crm_conversations c where c.last_direction = 'in')
  )
$$;
revoke all on function public.crm_report(uuid, date, date) from public, anon;
grant execute on function public.crm_report(uuid, date, date) to authenticated;
