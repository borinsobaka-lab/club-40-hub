/**
 * Тесты логики пакетных клубов в базе (правки 2026-10-13): роль «Старший
 * администратор», срок абонемента с первого посещения, «Посетил» без
 * абонемента, запись сверх остатка, возврат, замена тренера.
 *
 * Нужна база с полной схемой — её собирает db/test/build-schema.sh:
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 * Без переменной тесты пропускаются. Каждый сценарий — в своей транзакции,
 * которая откатывается: база после прогона та же.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

describe.skipIf(!url)("пакетные клубы (база)", () => {
  let db: SQL;

  beforeAll(() => {
    db = new SQL(url!);
  });
  afterAll(async () => {
    await db.close();
  });

  /** Сценарий в транзакции, которая всегда откатывается. */
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

  /** Сообщение ошибки запроса или null, если запрос прошёл (в точке сохранения). */
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

  type Seed = {
    studio: string;
    client: string;
    workout: string;
    pack: string;
    personalPack: string;
  };

  /** Клуб, клиент, тренировка, пакет на 2 тренировки (30 дней) и пакет 1 персональной. */
  async function seed(tx: Tx, format: "packages" | "subscription" = "packages"): Promise<Seed> {
    const [{ id: studio }] = await tx`
      insert into studios (name, format) values ('Тест', ${format}) returning id`;
    const [{ id: client }] = await tx`
      insert into clients (studio_id, first_name, last_name, email)
      values (${studio}, 'Анна', 'Тестова', ${`anna-${studio}@example.com`}) returning id`;
    const [{ id: workout }] = await tx`
      insert into workouts (studio_id, name) values (${studio}, 'Стретчинг') returning id`;
    const [{ id: pack }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
      values (${studio}, 'Пакет 2', 'package', 2, 30, 100) returning id`;
    const [{ id: personalPack }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, personal_count, duration_days, price)
      values (${studio}, 'Персональные 1', 'personal', 0, 1, 30, 80) returning id`;
    return { studio, client, workout, pack, personalPack };
  }

  async function sell(
    tx: Tx,
    s: Seed,
    opts: {
      membership?: string;
      kind?: string;
      installments?: { amount: number; days: number; paid: boolean }[];
    } = {},
  ): Promise<string> {
    const [{ id }] = await tx`
      insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
      values (${s.studio}, ${s.client}, ${opts.membership ?? s.pack}, 100, current_date, ${opts.kind ?? "new"})
      returning id`;
    for (const i of opts.installments ?? [])
      await tx`
        insert into sale_installments (sale_id, amount, due_date, paid)
        values (${id}, ${i.amount}, current_date + ${i.days}::int, ${i.paid})`;
    return id;
  }

  /** Занятие через days дней (групповое или персональное). */
  async function entry(tx: Tx, s: Seed, days: number, kind: "group" | "personal" = "group") {
    const [{ id }] = await tx`
      insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at)
      values (${s.studio}, ${kind === "group" ? s.workout : null}, ${kind},
              now() + make_interval(days => ${days}), now() + make_interval(days => ${days}, hours => 1))
      returning id`;
    return id as string;
  }

  /**
   * Действовать как администратор клуба (auth.uid() в RPC и триггерах):
   * персональные записи ставит только сотрудник. Учётная запись — в обход
   * handle_new_user: тот пускает в приложение только по карточке клиента.
   */
  async function asStaff(tx: Tx, s: Seed) {
    await tx`set local session_replication_role = replica`;
    const [{ id }] = await tx`
      insert into auth.users (email) values (${`admin-${s.studio}@example.com`}) returning id`;
    await tx`set local session_replication_role = origin`;
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${s.studio}, 'admin')`;
    await tx`select set_config('request.jwt.claim.sub', ${id}::text, true)`;
  }

  async function book(tx: Tx, s: Seed, entryId: string) {
    const [{ id }] = await tx`
      insert into schedule_bookings (studio_id, entry_id, client_id, status)
      values (${s.studio}, ${entryId}, ${s.client}, 'booked') returning id`;
    return id as string;
  }

  async function membershipOf(tx: Tx, saleId: string) {
    const [row] = await tx`
      select status, started_at, ends_at, visits_left, personal_left, starts_on_first_visit
        from client_memberships where sale_id = ${saleId}`;
    return row as {
      status: string;
      started_at: Date | null;
      ends_at: Date | null;
      visits_left: number | null;
      personal_left: number;
      starts_on_first_visit: boolean;
    };
  }

  /** Дата начала занятия по Тбилиси (с неё считается срок). */
  async function tbilisiDate(tx: Tx, entryId: string) {
    const [{ d }] = await tx`
      select ((starts_at at time zone 'Asia/Tbilisi')::date)::text as d
        from schedule_entries where id = ${entryId}`;
    return d as string;
  }

  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  // ---- 5. Роль «Старший администратор» ----

  test("старший администратор — допустимая роль, выдуманная — нет", async () => {
    await scenario(async (tx) => {
      expect(
        await failure(
          tx,
          () => tx`insert into trainers (full_name, role) values ('Ольга', 'senior_admin')`,
        ),
      ).toBeNull();
      expect(
        await failure(
          tx,
          () => tx`insert into trainers (full_name, role) values ('Ольга', 'boss')`,
        ),
      ).toContain("trainers_role_check");
    });
  });

  // ---- 10. Срок с первого посещения ----

  test("новая продажа пакетного клуба ждёт первого посещения, подписочного — идёт со дня продажи", async () => {
    await scenario(async (tx) => {
      const p = await seed(tx);
      const m = await membershipOf(tx, await sell(tx, p));
      expect(m).toMatchObject({
        status: "active",
        started_at: null,
        ends_at: null,
        visits_left: 2,
      });
      expect(m.starts_on_first_visit).toBe(true);

      const s = await seed(tx, "subscription");
      const sub = await membershipOf(tx, await sell(tx, s));
      expect(sub.status).toBe("active");
      expect(sub.starts_on_first_visit).toBe(false);
      const [{ today }] = await tx`select current_date::text as today`;
      expect(iso(sub.started_at)).toBe(today);
      expect(sub.ends_at).not.toBeNull();
    });
  });

  test("первое посещение начинает срок, снятая отметка возвращает «ожидает посещения»", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const sale = await sell(tx, s);
      const later = await entry(tx, s, 5);
      const earlier = await entry(tx, s, 2);
      const bLater = await book(tx, s, later);
      const bEarlier = await book(tx, s, earlier);

      await tx`update schedule_bookings set status = 'attended' where id = ${bLater}`;
      let m = await membershipOf(tx, sale);
      const laterDay = await tbilisiDate(tx, later);
      expect(iso(m.started_at)).toBe(laterDay);
      const [{ end }] = await tx`select (${laterDay}::date + 30)::text as end`;
      expect(iso(m.ends_at)).toBe(end);
      expect(m.visits_left).toBe(1);

      // Отметили и более раннее занятие — начало срока сдвигается на него,
      // конец — на столько же.
      await tx`update schedule_bookings set status = 'attended' where id = ${bEarlier}`;
      m = await membershipOf(tx, sale);
      const earlierDay = await tbilisiDate(tx, earlier);
      expect(iso(m.started_at)).toBe(earlierDay);
      const [{ end2 }] = await tx`select (${earlierDay}::date + 30)::text as end2`;
      expect(iso(m.ends_at)).toBe(end2);
      expect(m.visits_left).toBe(0);

      await tx`update schedule_bookings set status = 'booked' where id in (${bLater}, ${bEarlier})`;
      m = await membershipOf(tx, sale);
      expect(m).toMatchObject({
        status: "active",
        started_at: null,
        ends_at: null,
        visits_left: 2,
      });
    });
  });

  // ---- 16. «Посетил» без абонемента ----

  test("«Посетил» без остатка — ошибка; неуважительный пропуск — фиксируется без списания", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const sale = await sell(tx, s);
      const bookings = [];
      for (const d of [1, 2, 3, 4]) bookings.push(await book(tx, s, await entry(tx, s, d)));

      await tx`update schedule_bookings set status = 'attended' where id in (${bookings[0]}, ${bookings[1]})`;
      expect((await membershipOf(tx, sale)).visits_left).toBe(0);

      const err = await failure(
        tx,
        () => tx`update schedule_bookings set status = 'attended' where id = ${bookings[2]}`,
      );
      expect(err).toContain("нет абонемента с остатком");

      await tx`
        update schedule_bookings set status = 'no_show', no_show_excused = false
         where id = ${bookings[3]}`;
      const [nb] = await tx`
        select status, charged_membership_id from schedule_bookings where id = ${bookings[3]}`;
      expect(nb).toMatchObject({ status: "no_show", charged_membership_id: null });

      // Продали абонемент — то же посещение отмечается и списывается с него.
      const sale2 = await sell(tx, s);
      expect(
        await failure(
          tx,
          () => tx`update schedule_bookings set status = 'attended' where id = ${bookings[2]}`,
        ),
      ).toBeNull();
      expect((await membershipOf(tx, sale2)).visits_left).toBe(1);
    });
  });

  test("без абонемента нельзя отметить и персональное, а в подписочном клубе — можно", async () => {
    await scenario(async (tx) => {
      const p = await seed(tx);
      await asStaff(tx, p);
      const personal = await book(tx, p, await entry(tx, p, 1, "personal"));
      expect(
        await failure(
          tx,
          () => tx`update schedule_bookings set status = 'attended' where id = ${personal}`,
        ),
      ).toContain("нет абонемента");

      const s = await seed(tx, "subscription");
      const b = await book(tx, s, await entry(tx, s, 1));
      expect(
        await failure(
          tx,
          () => tx`update schedule_bookings set status = 'attended' where id = ${b}`,
        ),
      ).toBeNull();
    });
  });

  // ---- 15. Запись сверх остатка ----

  test("с 2 тренировками на балансе клиент записывается из приложения на 4 занятия", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const [{ id: user }] = await tx`
        insert into auth.users (email) select email from clients where id = ${s.client}
        returning id`;
      await tx`update clients set user_id = ${user} where id = ${s.client}`;
      await sell(tx, s);
      await tx`select set_config('request.jwt.claim.sub', ${user}::text, true)`;
      for (const d of [1, 2, 3, 4]) {
        const [{ r }] = await tx`select book_schedule_entry(${await entry(tx, s, d)}) as r`;
        expect(r).toMatchObject({ ok: true, waitlisted: false });
      }
      const [{ n }] = await tx`
        select count(*)::int as n from schedule_bookings
         where client_id = ${s.client} and status = 'booked'`;
      expect(n).toBe(4);
    });
  });

  // ---- 6. Возврат ----

  test("возврат: абонемент «Возврат», невнесённые платежи сняты, неотмеченные записи удалены с журналом", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const sale = await sell(tx, s, {
        installments: [
          { amount: 50, days: 0, paid: true },
          { amount: 25, days: 30, paid: false },
          { amount: 25, days: 60, paid: false },
        ],
      });
      const attended = await book(tx, s, await entry(tx, s, 1));
      await tx`update schedule_bookings set status = 'attended' where id = ${attended}`;
      const future = await book(tx, s, await entry(tx, s, 3));
      await asStaff(tx, s);
      const personalEntry = await entry(tx, s, 4, "personal");
      const personal = await book(tx, s, personalEntry);
      const [{ logs }] = await tx`
        select count(*)::int as logs from bookings_log where booking_id = ${future}`;
      expect(logs).toBe(1);

      await tx`insert into refunds (studio_id, sale_id, amount) values (${s.studio}, ${sale}, 40)`;

      expect((await membershipOf(tx, sale)).status).toBe("refunded");
      const inst = await tx`
        select paid, refunded from sale_installments where sale_id = ${sale} order by due_date`;
      expect(inst).toEqual([
        { paid: true, refunded: false },
        { paid: false, refunded: true },
        { paid: false, refunded: true },
      ]);
      const left = await tx`
        select id, status from schedule_bookings where client_id = ${s.client} order by id`;
      // Отмеченное посещение остаётся; будущая групповая — удалена; персональная —
      // с другого вида баланса, её возврат пакета тренировок не трогает.
      expect(left.map((r: { id: string }) => r.id).sort()).toEqual([attended, personal].sort());
      const [{ logs2 }] = await tx`
        select count(*)::int as logs2 from bookings_log where booking_id = ${future}`;
      expect(logs2).toBe(0);

      const [row] = await tx`
        select membership_status, payment_state, next_due_date
          from client_packages_list where id = ${sale}`;
      expect(row).toMatchObject({
        membership_status: "refunded",
        payment_state: "refunded",
        next_due_date: null,
      });
      // С возвратом записаться уже нельзя.
      const [{ cnt }] = await tx`
        select count(*)::int as cnt from client_memberships
         where client_id = ${s.client} and status in ('active', 'frozen', 'pending')`;
      expect(cnt).toBe(0);
    });
  });

  test("возврат при ждущем продлении: записи остаются, продление становится текущим", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const sale = await sell(tx, s);
      const renewal = await sell(tx, s, { kind: "renewal" });
      expect((await membershipOf(tx, renewal)).status).toBe("pending");
      const future = await book(tx, s, await entry(tx, s, 3));

      await tx`insert into refunds (studio_id, sale_id, amount) values (${s.studio}, ${sale}, 100)`;

      expect((await membershipOf(tx, sale)).status).toBe("refunded");
      expect((await membershipOf(tx, renewal)).status).toBe("active");
      const [{ n }] =
        await tx`select count(*)::int as n from schedule_bookings where id = ${future}`;
      expect(n).toBe(1);
    });
  });

  test("возврат пакета персональных удаляет только персональные записи", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await sell(tx, s);
      const personalSale = await sell(tx, s, { membership: s.personalPack });
      await asStaff(tx, s);
      const group = await book(tx, s, await entry(tx, s, 2));
      const personal = await book(tx, s, await entry(tx, s, 3, "personal"));

      await tx`insert into refunds (studio_id, sale_id, amount) values (${s.studio}, ${personalSale}, 80)`;

      expect((await membershipOf(tx, personalSale)).status).toBe("refunded");
      const ids = (await tx`select id from schedule_bookings where client_id = ${s.client}`).map(
        (r: { id: string }) => r.id,
      );
      expect(ids).toContain(group);
      expect(ids).not.toContain(personal);
    });
  });

  test("возврат по уже заменённому абонементу: строка «Возврат», а не «Оплачен полностью»", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const old = await sell(tx, s, {
        installments: [
          { amount: 50, days: 0, paid: true },
          { amount: 50, days: 30, paid: false },
        ],
      });
      await sell(tx, s); // новая продажа заменила прежний абонемент
      expect((await membershipOf(tx, old)).status).toBe("replaced");

      await tx`insert into refunds (studio_id, sale_id, amount) values (${s.studio}, ${old}, 50)`;

      const [row] = await tx`
        select membership_status, payment_state from client_packages_list where id = ${old}`;
      expect(row).toMatchObject({ membership_status: "replaced", payment_state: "refunded" });
    });
  });

  test("возврат в подписочном клубе абонемент и записи не трогает", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx, "subscription");
      const sale = await sell(tx, s, {
        installments: [
          { amount: 50, days: 0, paid: true },
          { amount: 50, days: 30, paid: false },
        ],
      });
      const future = await book(tx, s, await entry(tx, s, 3));

      await tx`insert into refunds (studio_id, sale_id, amount) values (${s.studio}, ${sale}, 50)`;

      expect((await membershipOf(tx, sale)).status).toBe("active");
      const [{ refunded }] = await tx`
        select count(*) filter (where refunded)::int as refunded from sale_installments
         where sale_id = ${sale}`;
      expect(refunded).toBe(0);
      const [{ n }] =
        await tx`select count(*)::int as n from schedule_bookings where id = ${future}`;
      expect(n).toBe(1);
    });
  });

  // ---- 11. Замена тренера ----

  test("замена уходит вместе с тренером занятия; заменить тренера им же нельзя", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const e = await entry(tx, s, 2);
      const [{ id: anna }] = await tx`
        insert into trainers (full_name, role) values ('Анна', 'trainer') returning id`;
      const [{ id: olga }] = await tx`
        insert into trainers (full_name, role) values ('Ольга', 'trainer') returning id`;
      await tx`insert into schedule_entry_trainers (entry_id, trainer_id) values (${e}, ${olga})`;

      // Замена — только у тренера, который стоит на занятии.
      expect(
        await failure(
          tx,
          () => tx`
            insert into schedule_entry_substitutions (entry_id, trainer_id, replaced_trainer_id)
            values (${e}, ${anna}, ${olga})`,
        ),
      ).toContain("foreign key");
      expect(
        await failure(
          tx,
          () => tx`
            insert into schedule_entry_substitutions (entry_id, trainer_id, replaced_trainer_id)
            values (${e}, ${olga}, ${olga})`,
        ),
      ).toContain("schedule_entry_substitutions_not_self");

      await tx`
        insert into schedule_entry_substitutions (entry_id, trainer_id, replaced_trainer_id)
        values (${e}, ${olga}, ${anna})`;
      await tx`delete from schedule_entry_trainers where entry_id = ${e} and trainer_id = ${olga}`;
      const [{ n }] = await tx`
        select count(*)::int as n from schedule_entry_substitutions where entry_id = ${e}`;
      expect(n).toBe(0);
    });
  });

  test("у таблицы замен одна связь с trainers — прежние запросы тренеров однозначны", async () => {
    await scenario(async (tx) => {
      // PostgREST считает таблицу связкой «многие ко многим», только если обе
      // её связи входят в первичный ключ; replaced_trainer_id — не входит.
      const fks = await tx`
        select c.conname, c.confrelid::regclass::text as target,
               array(select a.attname from unnest(c.conkey) k
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)::text[] as cols
          from pg_constraint c
         where c.conrelid = 'public.schedule_entry_substitutions'::regclass and c.contype = 'f'
         order by c.conname`;
      const toTrainers = fks.filter((f: { target: string }) => f.target === "trainers");
      expect(toTrainers.map((f: { cols: string[] }) => f.cols)).toEqual([["replaced_trainer_id"]]);
      const [{ pk }] = await tx`
        select array(select a.attname from pg_index i
                     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                      where i.indrelid = 'public.schedule_entry_substitutions'::regclass
                        and i.indisprimary order by a.attname)::text[] as pk`;
      expect(pk).toEqual(["entry_id", "trainer_id"]);
    });
  });
});
