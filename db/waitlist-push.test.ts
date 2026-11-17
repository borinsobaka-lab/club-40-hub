/**
 * Тесты листа ожидания (2026-11-17,
 * db/migrations/2026-11-17_waitlist_spot_push.sql): освободилось место —
 * пуш «Освободилось место» всем ожидающим; из листа ожидания записываются
 * сами, если место есть.
 *
 * Нужна база с полной схемой — её собирает db/test/build-schema.sh:
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 * Без переменной тесты пропускаются. Каждый сценарий — в своей транзакции,
 * которая откатывается; отложенный триггер пуша срабатывает по
 * `set constraints all immediate` (в жизни — при фиксации транзакции).
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

describe.skipIf(!url)("лист ожидания: пуш «Освободилось место» (база)", () => {
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

  async function user(tx: Tx): Promise<string> {
    await tx`set local session_replication_role = replica`;
    const [{ id }] = await tx`
      insert into auth.users (email) values (${`u-${crypto.randomUUID()}@example.com`}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  async function as(tx: Tx, userId: string) {
    await tx`select set_config('request.jwt.claim.sub', ${userId}::text, true)`;
    await tx`set local role authenticated`;
  }

  async function asServer(tx: Tx) {
    await tx`reset role`;
    await tx`select set_config('request.jwt.claim.sub', '', true)`;
  }

  async function client(tx: Tx, studio: string, first: string): Promise<string> {
    const userId = await user(tx);
    await tx`
      insert into clients (studio_id, first_name, last_name, full_name, email, user_id)
      values (${studio}, ${first}, 'Тестова', ${`Тестова ${first}`},
              ${`c-${crypto.randomUUID()}@example.com`}, ${userId})`;
    return userId;
  }

  type Seed = { studio: string; entry: string; a: string; b: string; c: string };

  /** Пакетный клуб, занятие на 1 место через `hours` часов, три клиента. */
  async function seed(tx: Tx, hours = 5): Promise<Seed> {
    const [{ id: studio }] =
      await tx`insert into studios (name, format) values ('Ваке', 'packages') returning id`;
    const [{ id: workout }] =
      await tx`insert into workouts (studio_id, name) values (${studio}, 'Стретчинг') returning id`;
    const [{ id: entry }] = await tx.unsafe(
      `insert into schedule_entries (studio_id, workout_id, kind, capacity, starts_at, ends_at)
       values ($1, $2, 'group', 1, now() + make_interval(mins => $3::int),
               now() + make_interval(mins => $3::int) + interval '1 hour')
       returning id`,
      [studio, workout, Math.round(hours * 60)],
    );
    return {
      studio,
      entry,
      a: await client(tx, studio, "Анна"),
      b: await client(tx, studio, "Белла"),
      c: await client(tx, studio, "Вера"),
    };
  }

  async function book(tx: Tx, userId: string, entry: string) {
    await as(tx, userId);
    const [{ r }] = await tx`select book_schedule_entry(${entry}::uuid) as r`;
    await asServer(tx);
    return r as Record<string, unknown>;
  }

  async function cancel(tx: Tx, userId: string, entry: string) {
    await as(tx, userId);
    const [{ r }] = await tx`select cancel_schedule_booking(${entry}::uuid) as r`;
    await asServer(tx);
    return r as Record<string, unknown>;
  }

  /** Одна запись — первому, двое в листе ожидания. */
  async function fullClass(tx: Tx, s: Seed) {
    expect(await book(tx, s.a, s.entry)).toMatchObject({ ok: true, waitlisted: false });
    expect(await book(tx, s.b, s.entry)).toMatchObject({ ok: true, waitlisted: true });
    expect(await book(tx, s.c, s.entry)).toMatchObject({ ok: true, waitlisted: true });
  }

  async function flush(tx: Tx) {
    await tx`set constraints all immediate`;
    await tx`set constraints all deferred`;
  }

  async function pushes(tx: Tx) {
    return tx`
      select n.title, n.message, r.user_id
        from push_notifications n join push_recipients r on r.notification_id = n.id
       where n.trigger_key = 'waitlist_spot_open'`;
  }

  test("клиент отменил запись — пуш всем из листа ожидания", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await flush(tx);
      expect((await pushes(tx)).length).toBe(0);

      expect(await cancel(tx, s.a, s.entry)).toMatchObject({ ok: true });
      await flush(tx);
      const rows = await pushes(tx);
      expect(rows.map((r) => r.user_id).sort()).toEqual([s.b, s.c].sort());
      expect(rows[0].title).toBe("Освободилось место");
      expect(rows.find((r) => r.user_id === s.b)!.message).toContain("Белла");
      expect(rows[0].message).toContain("«Стретчинг»");
    });
  });

  test("из листа ожидания записываются сами, пока место есть", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await cancel(tx, s.a, s.entry);

      expect(await book(tx, s.b, s.entry)).toMatchObject({
        ok: true,
        waitlisted: false,
        from_waitlist: true,
        booked_count: 1,
      });
      const [e] = await tx`select booked_count, waitlist_count from schedule_entries where id = ${s.entry}`;
      expect(e).toMatchObject({ booked_count: 1, waitlist_count: 1 });
      const [b] = await tx`
        select status from schedule_bookings where entry_id = ${s.entry} and user_id = ${s.b}`;
      expect(b.status).toBe("booked");

      // Место заняли — второй остаётся в очереди.
      expect(await book(tx, s.c, s.entry)).toMatchObject({
        ok: false,
        reason: "already_waitlisted",
      });
    });
  });

  test("отмена занятия клубом и удаление записей — без пуша", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await flush(tx);
      // Как отмена занятия: записи отменены, счётчик уменьшен, занятие отменено
      // — всё в одной транзакции.
      await tx`
        update schedule_bookings set status = 'cancelled', cancelled_at = now()
         where entry_id = ${s.entry} and status = 'booked'`;
      await tx`update schedule_entries set booked_count = 0 where id = ${s.entry}`;
      await tx`update schedule_entries set cancelled_at = now() where id = ${s.entry}`;
      await flush(tx);
      expect((await pushes(tx)).length).toBe(0);
    });
  });

  test("сотрудник удалил запись или увеличил вместимость — пуш", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await flush(tx);
      await tx`update schedule_entries set capacity = 2 where id = ${s.entry}`;
      await flush(tx);
      expect((await pushes(tx)).length).toBe(2);
    });
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await flush(tx);
      await tx`delete from schedule_bookings where entry_id = ${s.entry} and user_id = ${s.a}`;
      await flush(tx);
      expect((await pushes(tx)).length).toBe(2);
    });
  });

  test("без пуша: скоро начало, триггер выключен, повтор в течение 10 минут", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx, 0.2); // через 12 минут
      await fullClass(tx, s);
      await cancel(tx, s.a, s.entry);
      await flush(tx);
      expect((await pushes(tx)).length).toBe(0);
    });
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await tx`update push_triggers set enabled = false where key = 'waitlist_spot_open'`;
      await cancel(tx, s.a, s.entry);
      await flush(tx);
      expect((await pushes(tx)).length).toBe(0);
    });
    await scenario(async (tx) => {
      const s = await seed(tx);
      await fullClass(tx, s);
      await cancel(tx, s.a, s.entry);
      await flush(tx);
      expect((await pushes(tx)).length).toBe(2);
      // Место заняли и снова освободили — те же люди не получают второй пуш
      // подряд (журнал — с другим ref, как следующая транзакция).
      await tx`update push_trigger_log set ref = ref || '-prev' where trigger_key = 'waitlist_spot_open'`;
      await book(tx, s.a, s.entry);
      await cancel(tx, s.a, s.entry);
      await flush(tx);
      expect((await pushes(tx)).length).toBe(2);
    });
  });

  test("подписочный клуб — тот же пуш своего приложения", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await tx`update studios set format = 'subscription' where id = ${s.studio}`;
      // Запись без RPC (абонемент подписочного клуба не нужен для проверки).
      await tx`
        insert into schedule_bookings (studio_id, entry_id, user_id, status)
        values (${s.studio}, ${s.entry}, ${s.a}, 'booked'),
               (${s.studio}, ${s.entry}, ${s.b}, 'waitlist')`;
      await tx`update schedule_entries set booked_count = 1, waitlist_count = 1 where id = ${s.entry}`;
      await flush(tx);
      expect((await pushes(tx)).length).toBe(0);
      await cancel(tx, s.a, s.entry);
      await flush(tx);
      const rows = await tx`
        select n.studio_ids, r.user_id
          from push_notifications n join push_recipients r on r.notification_id = n.id
         where n.trigger_key = 'waitlist_spot_open'`;
      expect(rows.map((r) => r.user_id)).toEqual([s.b]);
    });
  });
});
