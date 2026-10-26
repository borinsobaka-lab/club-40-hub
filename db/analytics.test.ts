/**
 * Тесты «Аналитики» (db/migrations/2026-10-26_zz_analytics.sql): кто какие
 * клубы видит, выручка, виды продаж (новый / продление / возврат), средний
 * чек, занятия, воронка пробных, нулевая номенклатура, точка 0.
 *
 * Нужна база с полной схемой — как для db/packages.test.ts:
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 * Без переменной тесты пропускаются. Каждый сценарий откатывается.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

describe.skipIf(!url)("аналитика (база)", () => {
  let db: SQL;

  beforeAll(() => {
    db = new SQL(url!);
  });
  afterAll(async () => {
    await db.close();
  });

  async function scenario(fn: (tx: Tx) => Promise<void>) {
    try {
      await db.begin(async (tx) => {
        await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }

  async function failure(tx: Tx, run: () => Promise<unknown>): Promise<string | null> {
    await tx`savepoint t`;
    try {
      await run();
      await tx`release savepoint t`;
      return null;
    } catch (e) {
      await tx`rollback to savepoint t`;
      return (e as Error).message;
    }
  }

  async function user(tx: Tx): Promise<string> {
    await tx`set local session_replication_role = replica`;
    const [{ id }] =
      await tx`insert into auth.users (email) values (${`u-${crypto.randomUUID()}@example.com`}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  async function studio(
    tx: Tx,
    format: "packages" | "subscription" = "packages",
    city = "Тбилиси",
  ) {
    const [{ id }] = await tx`
      insert into studios (name, format, city) values (${`Клуб ${crypto.randomUUID().slice(0, 4)}`}, ${format}, ${city})
      returning id`;
    return id as string;
  }

  async function staff(tx: Tx, studioId: string, role = "admin"): Promise<string> {
    const id = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${studioId}, ${role}::app_role)`;
    return id;
  }

  async function as(tx: Tx, userId: string) {
    await tx`select set_config('request.jwt.claim.sub', ${userId}::text, true)`;
    await tx`set local role authenticated`;
  }
  async function asServer(tx: Tx) {
    await tx`reset role`;
    await tx`select set_config('request.jwt.claim.sub', '', true)`;
  }

  async function client(tx: Tx, studioId: string) {
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, email)
      values (${studioId}, 'Анна', 'Тестова', ${`c-${crypto.randomUUID()}@example.com`}) returning id`;
    return id as string;
  }

  async function membership(tx: Tx, studioId: string, kind = "package", price = 100) {
    const [{ id }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
      values (${studioId}, ${`${kind} ${price}`}, ${kind}, ${kind === "trial" ? 1 : 8}, 30, ${price})
      returning id`;
    return id as string;
  }

  async function sell(
    tx: Tx,
    studioId: string,
    clientId: string,
    membershipId: string,
    amount = 100,
    daysAgo = 0,
  ) {
    const [{ id }] = await tx`
      insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, created_at)
      values (${studioId}, ${clientId}, ${membershipId}, ${amount}, current_date - ${daysAgo}::int,
              now() - make_interval(days => ${daysAgo}))
      returning id`;
    return id as string;
  }

  /** Вызов RPC от имени сотрудника; результат — jsonb. */
  async function rpc<T>(tx: Tx, who: string, call: (tx: Tx) => Promise<{ r: T }[]>): Promise<T> {
    await as(tx, who);
    const [{ r }] = await call(tx);
    await asServer(tx);
    return r;
  }

  test("клубы аналитики: роль в клубе и открытый раздел; чужие клубы не отдаются", () =>
    scenario(async (tx) => {
      const s1 = await studio(tx);
      const s2 = await studio(tx);
      const admin = await staff(tx, s1); // строки разделов нет — открыто всё
      const reception = await staff(tx, s1);
      await tx`insert into admin_studio_permissions (user_id, studio_id, sections)
               values (${reception}, ${s1}, '{schedule,clients}')`;
      const analyst = await staff(tx, s1);
      await tx`insert into admin_studio_permissions (user_id, studio_id, sections)
               values (${analyst}, ${s1}, '{analytics}')`;
      const owner = await staff(tx, s2, "owner");
      await tx`insert into admin_studio_permissions (user_id, studio_id, sections)
               values (${owner}, ${s2}, '{}')`;

      const ids = async (who: string) =>
        (
          await rpc<{ studios: { id: string }[] }>(tx, who, (t) => t`select analytics_scope() as r`)
        ).studios.map((s) => s.id);
      expect(await ids(admin)).toEqual([s1]);
      expect(await ids(reception)).toEqual([]);
      expect(await ids(analyst)).toEqual([s1]);
      expect(await ids(owner)).toEqual([s2]);

      // Запрос чужого клуба ничего не отдаёт.
      const c = await client(tx, s2);
      await sell(tx, s2, c, await membership(tx, s2));
      const rev = await rpc<unknown[]>(
        tx,
        admin,
        (t) => t`select analytics_revenue(${[s2]}::uuid[], current_date - 1, current_date) as r`,
      );
      expect(rev).toEqual([]);
      const own = await rpc<unknown[]>(
        tx,
        owner,
        (t) => t`select analytics_revenue(${[s2]}::uuid[], current_date - 1, current_date) as r`,
      );
      expect(own.length).toBe(1);

      // Внутренние функции снаружи не вызываются.
      await as(tx, admin);
      expect(await failure(tx, () => tx`select analytics_ids(null)`)).toContain(
        "permission denied",
      );
      expect(
        await failure(tx, () => tx`select * from analytics_sale_origins(${[s1]}::uuid[])`),
      ).toContain("permission denied");
      await asServer(tx);
    }));

  test("выручка: без графика — в день продажи, рассрочка — внесённые платежи, прочие, возвраты", () =>
    scenario(async (tx) => {
      const s = await studio(tx, "subscription");
      const admin = await staff(tx, s);
      const c = await client(tx, s);
      const m = await membership(tx, s);
      await sell(tx, s, c, m, 100);
      const inst = await sell(tx, s, c, m, 100);
      await tx`insert into sale_installments (sale_id, amount, due_date, paid, paid_at)
               values (${inst}, 60, current_date, true, current_date), (${inst}, 40, current_date + 30, false, null)`;
      await tx`insert into other_sales (studio_id, item_kind, item_name, total_amount, sold_at) values (${s}, 'product', 'Вода', 30, current_date)`;
      await tx`insert into refunds (studio_id, sale_id, amount, refunded_at) values (${s}, ${inst}, 20, now())`;
      // Продажа вне периода не попадает.
      await sell(tx, s, c, m, 500, 40);

      const rows = await rpc<[string, string, number, number, number][]>(
        tx,
        admin,
        (t) => t`select analytics_revenue(${[s]}::uuid[], current_date - 7, current_date) as r`,
      );
      expect(rows.length).toBe(1);
      const [, , mem, other, refunds] = rows[0];
      expect([Number(mem), Number(other), Number(refunds)]).toEqual([160, 30, 20]);

      const months = await rpc<[string, string, number][]>(
        tx,
        admin,
        (t) => t`select analytics_revenue(null, current_date - 60, current_date, 'month') as r`,
      );
      const total = months.reduce((sum, r) => sum + Number(r[2]), 0);
      expect(total).toBe(660);
      for (const r of months) expect(String(r[1]).endsWith("-01")).toBe(true);
    }));

  test("продажи: новый, продление, возврат, пробное; средний чек по оплаченным", () =>
    scenario(async (tx) => {
      const s = await studio(tx, "subscription");
      const admin = await staff(tx, s);
      const c = await client(tx, s);
      const m = await membership(tx, s);
      const trial = await membership(tx, s, "trial", 0);
      await sell(tx, s, c, trial, 0, 100);
      const first = await sell(tx, s, c, m, 100, 90);
      // Первый закончился 60 дней назад — следующая покупка через 60 дней — возврат.
      await tx`update client_memberships set ends_at = current_date - 60 where sale_id = ${first}`;
      const back = await sell(tx, s, c, m, 100, 1);
      await tx`update client_memberships set ends_at = current_date + 29 where sale_id = ${back}`;
      // Пока действует прежний — продление.
      await sell(tx, s, c, m, 100, 0);
      // Другой клиент — новый.
      const c2 = await client(tx, s);
      await sell(tx, s, c2, m, 100, 0);

      const r = await rpc<{
        sold: [string, string, string, string, number, number][];
        paid_total: [string, string, number, number, number][];
        names: Record<string, [string, string]>;
      }>(
        tx,
        admin,
        (t) => t`select analytics_sales(${[s]}::uuid[], current_date - 7, current_date) as r`,
      );
      const byOrigin = Object.fromEntries(
        ["new", "renewal", "return"].map((o) => [
          o,
          r.sold.filter((x) => x[3] === o).reduce((sum, x) => sum + Number(x[4]), 0),
        ]),
      );
      expect(byOrigin).toEqual({ new: 1, renewal: 1, return: 1 });
      expect(r.names[m][0]).toBe("package 100");
      const paid = Object.fromEntries(
        r.paid_total.map((x) => [x[1], [Number(x[2]), Number(x[4])]]),
      );
      expect(paid.new).toEqual([100, 1]);
      expect(paid.return).toEqual([100, 1]);

      // Период шире — пробное своим видом, первая продажа — новая.
      const all = await rpc<{ sold: [string, string, string, string, number, number][] }>(
        tx,
        admin,
        (t) => t`select analytics_sales(${[s]}::uuid[], current_date - 120, current_date) as r`,
      );
      const origins = all.sold.map((x) => x[3]).sort();
      expect(origins).toEqual(["new", "new", "renewal", "return", "trial"]);
    }));

  test("занятия: прошедшие и не отменённые, записались и пришли", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const [{ id: w }] =
        await tx`insert into workouts (studio_id, name) values (${s}, 'Стретчинг') returning id`;
      const mk = async (hoursAgo: number) => {
        const [{ id }] = await tx`
          insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at, capacity)
          values (${s}, ${w}, 'group', now() - make_interval(hours => ${hoursAgo}),
                  now() - make_interval(hours => ${hoursAgo - 1}), 10) returning id`;
        return id as string;
      };
      const past = await mk(3);
      const cancelled = await mk(5);
      await tx`update schedule_entries set cancelled_at = now() where id = ${cancelled}`;
      await mk(-5); // будущее
      const clients = await Promise.all([0, 1, 2, 3].map(() => client(tx, s)));
      // Статусы прямо, без триггеров списания и проверок записи.
      await tx`set local session_replication_role = replica`;
      for (const [i, status] of ["attended", "no_show", "booked", "cancelled"].entries())
        await tx`insert into schedule_bookings (studio_id, entry_id, client_id, status)
                 values (${s}, ${past}, ${clients[i]}, ${status}::booking_status)`;
      await tx`set local session_replication_role = origin`;

      const r = await rpc<{ rows: unknown[][]; names: Record<string, string> }>(
        tx,
        admin,
        (t) => t`select analytics_classes(${[s]}::uuid[], current_date - 1, current_date + 1) as r`,
      );
      expect(r.rows.length).toBe(1);
      const [, , workout, kind, n, booked, attended, noShow, cap, capAttended] = r.rows[0];
      expect([workout, kind]).toEqual([w, "group"]);
      expect([n, booked, attended, noShow, cap, capAttended].map(Number)).toEqual([
        1, 3, 1, 1, 10, 1,
      ]);
      expect(r.names[w]).toBe("Стретчинг");
    }));

  test("воронка пробных: дата пробного — посещение, покупка в день и за 14 дней", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      await tx`select set_config('request.jwt.claim.sub', ${admin}::text, true)`;
      const [{ id: w }] =
        await tx`insert into workouts (studio_id, name) values (${s}, 'Стретчинг') returning id`;
      const trial = await membership(tx, s, "trial", 10);
      const pack = await membership(tx, s, "package", 100);

      // Клиент 1: пробное 3 дня назад, пришёл 2 дня назад, купил в тот же день.
      // Клиент 2: пробное купил, не пришёл.
      // Клиент 3: пришёл, купил через 5 дней.
      const funnel = async (visitDaysAgo: number | null, buyDaysAgo: number | null) => {
        const c = await client(tx, s);
        const sale = await sell(tx, s, c, trial, 10, 3);
        if (visitDaysAgo !== null) {
          const [{ id: e }] = await tx`
            insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at)
            values (${s}, ${w}, 'group', now() - make_interval(days => ${visitDaysAgo}),
                    now() - make_interval(days => ${visitDaysAgo}, hours => -1)) returning id`;
          const [{ id: b }] = await tx`
            insert into schedule_bookings (studio_id, entry_id, client_id, status)
            values (${s}, ${e}, ${c}, 'booked') returning id`;
          await tx`update schedule_bookings set status = 'attended' where id = ${b}`;
          const [{ charged }] = await tx`
            select (charged_membership_id = (select id from client_memberships where sale_id = ${sale})) as charged
              from schedule_bookings where id = ${b}`;
          expect(charged).toBe(true);
        }
        if (buyDaysAgo !== null) await sell(tx, s, c, pack, 100, buyDaysAgo);
      };
      await funnel(2, 2);
      await funnel(null, null);
      await funnel(10, 5);
      await tx`select set_config('request.jwt.claim.sub', '', true)`;

      const r = await rpc<{ rows: unknown[][]; names: Record<string, string> }>(
        tx,
        admin,
        (t) =>
          t`select analytics_trials(${[s]}::uuid[], current_date - 30, current_date, 'month') as r`,
      );
      const sum = (i: number) => r.rows.reduce((acc, row) => acc + Number(row[i]), 0);
      expect([sum(3), sum(4), sum(5), sum(6)]).toEqual([3, 2, 1, 2]);
      // Окно 14 дней ещё открыто только у тех, кто пришёл и не купил — таких нет.
      expect(sum(7)).toBe(0);
      expect(r.names[trial]).toBe("trial 10");
    }));

  test("нулевая номенклатура: продажи с нулём, кроме пробных", () =>
    scenario(async (tx) => {
      const s = await studio(tx, "subscription");
      const admin = await staff(tx, s);
      const c = await client(tx, s);
      await sell(tx, s, c, await membership(tx, s), 0);
      await sell(tx, s, c, await membership(tx, s, "trial", 0), 0);
      await tx`insert into other_sales (studio_id, item_kind, item_name, total_amount, sold_at) values (${s}, 'product', 'Полотенце', 0, current_date)`;
      const rows = await rpc<[string, string, string, number, string][]>(
        tx,
        admin,
        (t) => t`select analytics_zero(${[s]}::uuid[], current_date - 1, current_date) as r`,
      );
      expect(rows.map((r) => [r[1], r[2], Number(r[3])]).sort()).toEqual([
        ["membership", "package 100", 1],
        ["other", "Полотенце", 1],
      ]);
    }));

  test("точка 0: владелец клуба вне модели прав и право analytics.manage", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const owner = await staff(tx, s, "owner");
      const admin = await staff(tx, s);
      await as(tx, admin);
      expect(
        await failure(tx, () => tx`select analytics_settings_save(${s}, 1000, null)`),
      ).toContain("Нет права");
      await asServer(tx);
      await as(tx, owner);
      await tx`select analytics_settings_save(${s}, 850000, current_date)`;
      // Таблица напрямую не пишется.
      expect(
        await failure(
          tx,
          () => tx`update analytics_studio_settings set point_zero = 1 where studio_id = ${s}`,
        ),
      ).toContain("permission denied");
      await asServer(tx);

      const scope = await rpc<{
        can_manage: boolean;
        studios: { point_zero: number; can_manage: boolean }[];
      }>(tx, admin, (t) => t`select analytics_scope() as r`);
      expect(scope.can_manage).toBe(false);
      expect(Number(scope.studios[0].point_zero)).toBe(850000);

      // Человек модели прав: решает сетевое право, а не роль владельца.
      await tx`insert into access_user_rights (user_id, rights, portal) values (${owner}, '{}', true)`;
      await as(tx, owner);
      expect(await failure(tx, () => tx`select analytics_settings_save(${s}, 1, null)`)).toContain(
        "Нет права",
      );
      await asServer(tx);
      await tx`update access_user_rights set rights = '{analytics.manage}' where user_id = ${owner}`;
      await as(tx, owner);
      await tx`select analytics_settings_save(${s}, 1, null)`;
      await asServer(tx);
    }));

  test("каталог прав: раздел клуба «Аналитика», у куратора включён", () =>
    scenario(async (tx) => {
      const [perm] = await tx`select scope from access_permissions where key = 'club.analytics'`;
      expect(perm.scope).toBe("studio");
      const [{ n }] = await tx`
        select count(*)::int as n from access_role_permissions p join access_roles r on r.id = p.role_id
         where r.system_key = 'curator' and p.perm_key = 'club.analytics'`;
      expect(n).toBe(1);
    }));
});
