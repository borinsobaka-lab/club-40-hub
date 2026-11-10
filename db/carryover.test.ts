/**
 * Абонемент переноса пакетных клубов
 * (db/migrations/2026-11-10_packages_carryover_membership.sql): номенклатура
 * без остатка и срока, остаток и срок — у продажи «Перенос»; абонемент
 * действует во всех клубах сети, списывается как пакет, ждёт в очереди при
 * живом абонементе того же вида; клиент видит его название в приложении.
 *
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 *
 * Без переменной тесты пропускаются; сценарии откатываются.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

describe.skipIf(!url)("абонемент переноса (база)", () => {
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

  async function studio(tx: Tx, format = "packages"): Promise<string> {
    const [{ id }] =
      await tx`insert into studios (name, format) values ('Клуб', ${format}) returning id`;
    return id as string;
  }

  async function user(tx: Tx): Promise<string> {
    await tx`set local session_replication_role = replica`;
    const [{ id }] = await tx`
      insert into auth.users (email) values (${`u-${crypto.randomUUID()}@example.com`}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  async function client(tx: Tx, studioId: string, userId: string | null = null): Promise<string> {
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, email, user_id)
      values (${studioId}, 'Анна', 'Тестова', ${`c-${crypto.randomUUID()}@example.com`}, ${userId})
      returning id`;
    return id as string;
  }

  /** Номенклатура «Абонемент переноса» — как её заводят «Номенклатуры». */
  async function carryoverPack(tx: Tx, studioId: string): Promise<string> {
    const [{ id }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price,
                               max_payments, is_active)
      values (${studioId}, 'Перенос из студии', 'carryover', null, null, 0, 1, false)
      returning id`;
    return id as string;
  }

  async function pack(tx: Tx, studioId: string): Promise<string> {
    const [{ id }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
      values (${studioId}, 'Пакет 8', 'package', 8, 30, 200) returning id`;
    return id as string;
  }

  type Carry = {
    visits?: number;
    personal?: number;
    diagnostics?: number;
    starts?: string;
    ends?: string;
    debt?: number;
  };

  async function sellCarryover(
    tx: Tx,
    studioId: string,
    clientId: string,
    membershipId: string,
    c: Carry = {},
  ): Promise<string> {
    const debt = c.debt ?? 0;
    const [{ id }] = await tx`
      insert into sales (studio_id, client_id, membership_id, total_amount, down_payment_amount,
                         remaining_installments, sold_at, sale_kind, list_price, discount_amount,
                         carryover_visits, carryover_personal, carryover_diagnostics,
                         carryover_starts_on, carryover_ends_on)
      values (${studioId}, ${clientId}, ${membershipId}, ${debt}, 0, ${debt > 0 ? 1 : 0},
              current_date, 'carryover', 500, 50,
              ${c.visits ?? 7}, ${c.personal ?? 0}, ${c.diagnostics ?? 0},
              ${c.starts ?? "2026-10-01"}::date,
              coalesce(${c.ends ?? null}::date, current_date + 40))
      returning id`;
    return id as string;
  }

  async function term(tx: Tx, saleId: string) {
    const [row] = await tx`
      select id, status, visits_left, personal_left, diagnostics_left, balance_kind,
             started_at::text as started_at, ends_at, starts_on_first_visit
        from client_memberships where sale_id = ${saleId}`;
    return row as {
      id: string;
      status: string;
      visits_left: number;
      personal_left: number;
      diagnostics_left: number;
      balance_kind: string;
      started_at: string;
      ends_at: Date;
      starts_on_first_visit: boolean;
    };
  }

  async function bookAndAttend(tx: Tx, studioId: string, clientId: string) {
    const [{ id: w }] =
      await tx`insert into workouts (studio_id, name) values (${studioId}, 'Стретчинг') returning id`;
    const [{ id: e }] = await tx`
      insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at)
      values (${studioId}, ${w}, 'group', now() - interval '2 hours', now() - interval '1 hour')
      returning id`;
    const [{ id: b }] = await tx`
      insert into schedule_bookings (studio_id, entry_id, client_id, status)
      values (${studioId}, ${e}, ${clientId}, 'booked') returning id`;
    await tx`update schedule_bookings set status = 'attended' where id = ${b}`;
    return b as string;
  }

  test("номенклатура переноса — без цены, остатка и срока, в витрину не попадает", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      await carryoverPack(tx, a);
      expect(
        await failure(
          tx,
          () => tx`
            insert into memberships (studio_id, name, kind, visits_count, price, is_active)
            values (${a}, 'Перенос', 'carryover', 10, 0, false)`,
        ),
      ).toContain("memberships_carryover_terms_check");
      expect(
        await failure(
          tx,
          () => tx`
            insert into memberships (studio_id, name, kind, price, is_active)
            values (${a}, 'Перенос', 'carryover', 0, true)`,
        ),
      ).toContain("memberships_carryover_terms_check");

      // Выданную номенклатуру в перенос и обратно не переводят.
      const p = await pack(tx, a);
      const c = await client(tx, a);
      await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sale_kind)
        values (${a}, ${c}, ${p}, 200, 'new')`;
      expect(
        await failure(
          tx,
          () => tx`
            update memberships set kind = 'carryover', visits_count = null, duration_days = null,
                                   price = 0, is_active = false
             where id = ${p}`,
        ),
      ).toContain("не меняется");
    });
  });

  test("продажа «Перенос» выдаёт абонемент с остатком и сроком из продажи", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const c = await client(tx, a);
      const m = await carryoverPack(tx, a);
      const sale = await sellCarryover(tx, a, c, m, {
        visits: 7,
        personal: 2,
        diagnostics: 1,
        starts: "2026-10-01",
        ends: "2027-01-15",
      });
      const t = await term(tx, sale);
      expect(t.status).toBe("active");
      expect(t.visits_left).toBe(7);
      expect(t.personal_left).toBe(2);
      expect(t.diagnostics_left).toBe(1);
      expect(t.balance_kind).toBe("group");
      expect(t.started_at).toBe("2026-10-01");
      expect(t.starts_on_first_visit).toBe(false);
      const [s] = await tx`select list_price, discount_amount from sales where id = ${sale}`;
      expect(Number(s.list_price)).toBe(0);
      expect(Number(s.discount_amount)).toBe(0);
    });
  });

  test("только персональные — пакет персональных", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const c = await client(tx, a);
      const m = await carryoverPack(tx, a);
      const t = await term(tx, await sellCarryover(tx, a, c, m, { visits: 0, personal: 3 }));
      expect(t.balance_kind).toBe("personal");
      expect(t.personal_left).toBe(3);
      expect(t.visits_left).toBe(0);
    });
  });

  test("тип продажи и номенклатуры совпадают; пустой перенос и подписочный клуб — нельзя", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const c = await client(tx, a);
      const m = await carryoverPack(tx, a);
      const p = await pack(tx, a);
      expect(
        await failure(
          tx,
          () => tx`
            insert into sales (studio_id, client_id, membership_id, total_amount, sale_kind)
            values (${a}, ${c}, ${m}, 0, 'new')`,
        ),
      ).toContain("продажей типа «Перенос»");
      expect(
        await failure(
          tx,
          () => tx`
            insert into sales (studio_id, client_id, membership_id, total_amount, sale_kind,
                               carryover_visits, carryover_personal, carryover_diagnostics,
                               carryover_starts_on, carryover_ends_on)
            values (${a}, ${c}, ${p}, 0, 'carryover', 5, 0, 0, current_date, current_date + 30)`,
        ),
      ).toContain("только абонемента переноса");
      expect(
        await failure(tx, () =>
          sellCarryover(tx, a, c, m, { visits: 0, personal: 0, diagnostics: 0 }),
        ),
      ).toContain("sales_carryover_terms_check");
      expect(
        await failure(tx, () =>
          sellCarryover(tx, a, c, m, { starts: "2026-12-01", ends: "2026-11-01" }),
        ),
      ).toContain("sales_carryover_terms_check");

      const s = await studio(tx, "subscription");
      const cs = await client(tx, s);
      expect(await failure(tx, () => sellCarryover(tx, s, cs, m))).toContain(
        "только в пакетных клубах",
      );
    });
  });

  test("списывается при «Посетил» в другом клубе сети", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const b = await studio(tx);
      const c = await client(tx, a);
      const m = await carryoverPack(tx, a);
      const sale = await sellCarryover(tx, a, c, m, { visits: 2 });
      const t = await term(tx, sale);

      await bookAndAttend(tx, b, c);
      expect((await term(tx, sale)).visits_left).toBe(1);
      const [{ charged }] = await tx`
        select charged_membership_id as charged from schedule_bookings
         where client_id = ${c} order by created_at desc limit 1`;
      expect(charged).toBe(t.id);

      await bookAndAttend(tx, b, c);
      expect((await term(tx, sale)).status).toBe("expired");
    });
  });

  test("при живом пакете перенос ждёт в очереди, после него — становится текущим", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const c = await client(tx, a);
      const p = await pack(tx, a);
      const [{ id: live }] = await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sale_kind)
        values (${a}, ${c}, ${p}, 200, 'new') returning id`;
      const m = await carryoverPack(tx, a);
      const sale = await sellCarryover(tx, a, c, m, { visits: 5 });
      expect((await term(tx, sale)).status).toBe("pending");
      expect((await term(tx, live as string)).status).toBe("active");

      await tx`update client_memberships set visits_left = 0 where sale_id = ${live}`;
      await tx`select packages_settle(${c})`;
      expect((await term(tx, live as string)).status).toBe("expired");
      const t = await term(tx, sale);
      expect(t.status).toBe("active");
      expect(t.visits_left).toBe(5);
    });
  });

  test("долг — невнесённый платёж; удаление продажи убирает абонемент", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const c = await client(tx, a);
      const m = await carryoverPack(tx, a);
      const sale = await sellCarryover(tx, a, c, m, { debt: 141 });
      await tx`
        insert into sale_installments (sale_id, due_date, amount, paid)
        values (${sale}, current_date + 7, 141, false)`;
      const [row] = await tx`select payment_state from client_packages_list where id = ${sale}`;
      expect(row.payment_state).toBe("pending");

      await tx`delete from sales where id = ${sale}`;
      const [{ n }] =
        await tx`select count(*)::int as n from client_memberships where client_id = ${c}`;
      expect(n).toBe(0);
    });
  });

  test("клиент видит название своего абонемента переноса, чужого — нет", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const b = await studio(tx);
      const m = await carryoverPack(tx, a);
      const uid = await user(tx);
      const c = await client(tx, b, uid);
      await sellCarryover(tx, b, c, m);
      const other = await carryoverPack(tx, a);

      await tx`select set_config('request.jwt.claim.sub', ${uid}::text, true)`;
      await tx`set local role authenticated`;
      const seen = await tx`select id from memberships where id in (${m}, ${other})`;
      expect(seen.map((r: { id: string }) => r.id)).toEqual([m]);
      const [mine] = await tx`
        select m.name from client_memberships cm join memberships m on m.id = cm.membership_id
         where cm.client_id = ${c}`;
      expect(mine.name).toBe("Перенос из студии");
      await tx`reset role`;
    });
  });

  test("NPS: перенесённому клиенту не приходят опросы новичка", async () => {
    await scenario(async (tx) => {
      const a = await studio(tx);
      const uid = await user(tx);
      const c = await client(tx, a, uid);
      const m = await carryoverPack(tx, a);
      await sellCarryover(tx, a, c, m, { visits: 10 });
      for (let i = 0; i < 4; i++) await bookAndAttend(tx, a, c);
      const [{ s }] = await tx`select nps_pending_survey(${uid}) as s`;
      expect(s?.survey_type ?? null).not.toBe("first_lessons");
    });
    // Для сравнения: с обычным пакетом тот же клиент — новичок.
    await scenario(async (tx) => {
      const a = await studio(tx);
      const uid = await user(tx);
      const c = await client(tx, a, uid);
      const p = await pack(tx, a);
      await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sale_kind)
        values (${a}, ${c}, ${p}, 200, 'new')`;
      for (let i = 0; i < 4; i++) await bookAndAttend(tx, a, c);
      const [{ s }] = await tx`select nps_pending_survey(${uid}) as s`;
      expect(s?.survey_type).toBe("first_lessons");
    });
  });
});
