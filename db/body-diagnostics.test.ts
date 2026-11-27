/**
 * Тесты результатов диагностики тела (2026-11-27,
 * db/migrations/2026-11-27_body_diagnostics.sql): форму заполняет только
 * тренер диагностики и только у записанного клиента, повтор — правка той же
 * строки, обязательные поля, срок правки, «не заполнено» за 7 дней; клиент
 * видит только свои диагностики; фото — папка карточки, чужой тренер не
 * загружает и не читает.
 *
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 * Без переменной тесты пропускаются. Каждый сценарий откатывается.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

const FORM = {
  activity_level: 5,
  emotional_level: 7,
  directions: ["Pilates"],
  restrictions: ["Диастаз"],
  goals: ["Подтянутая фигура"],
  priority_today: "Спина",
  chest_cm: 90,
  waist_cm: 64,
  hips_cm: 95,
  weight_kg: 60.5,
  balance_test: "Устойчиво",
  forward_bend: "До пола не достаёт",
  forward_bend_cm: 12,
  split_right_cm: 20,
  stage: 1,
  rec_trainings: "Рекомендую посещать 3 тренировки в неделю.",
  rec_directions: ["Pilates", "Yoga"],
};

describe.skipIf(!url)("диагностика тела (база)", () => {
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

  async function client(tx: Tx, studio: string, last: string) {
    const userId = await user(tx);
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, full_name, email, user_id, phone)
      values (${studio}, 'Анна', ${last}, ${`${last} Анна`}, ${`c-${crypto.randomUUID()}@example.com`}, ${userId}, '+995 555 11 22 33')
      returning id`;
    return { id: id as string, user: userId };
  }

  async function seed(tx: Tx) {
    const [{ id: studio }] =
      await tx`insert into studios (name, format) values ('Ваке', 'packages') returning id`;
    const [{ id: trainer }] =
      await tx`insert into trainers (full_name, role) values ('Ольга Тренер', 'trainer') returning id`;
    const [{ id: other }] =
      await tx`insert into trainers (full_name, role) values ('Нино Тренер', 'trainer') returning id`;
    const admin = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${admin}, ${studio}, 'admin')`;
    const tCard = await client(tx, studio, "Тренерова");
    const oCard = await client(tx, studio, "Другая");
    await as(tx, admin);
    await tx`insert into app_trainer_links (client_id, trainer_id) values (${tCard.id}, ${trainer})`;
    await tx`insert into app_trainer_links (client_id, trainer_id) values (${oCard.id}, ${other})`;
    await asServer(tx);
    const anna = await client(tx, studio, "Иванова");
    return { studio, trainer, other, admin, trainerUser: tCard.user, otherUser: oCard.user, anna };
  }

  type S = Awaited<ReturnType<typeof seed>>;

  async function diagnostic(tx: Tx, s: S, hours: number, trainer = s.trainer, clientId = s.anna.id) {
    const [{ id }] = await tx.unsafe(
      `insert into schedule_entries (studio_id, kind, starts_at, ends_at)
       values ($1, 'diagnostic', now() + make_interval(hours => $2::int),
               now() + make_interval(hours => $2::int) + interval '1 hour')
       returning id`,
      [s.studio, hours],
    );
    await tx`insert into schedule_entry_trainers (entry_id, trainer_id) values (${id}, ${trainer})`;
    // Диагностику записывает сотрудник.
    await as(tx, s.admin);
    await tx`
      insert into schedule_bookings (studio_id, entry_id, client_id, status)
      values (${s.studio}, ${id}, ${clientId}, 'booked')`;
    await asServer(tx);
    return id as string;
  }

  async function save(tx: Tx, entry: string, clientId: string, data: object = FORM) {
    const [{ id }] = await tx`
      select trainer_save_diagnostic(${entry}, ${clientId}, ${data}::jsonb) as id`;
    return id as string;
  }

  test("тренер диагностики заполняет, повтор — правка той же строки", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const e = await diagnostic(tx, s, 1);
      await as(tx, s.trainerUser);

      const [{ f }] = await tx`select trainer_diagnostic_form(${e}, ${s.anna.id}) as f`;
      expect(f.client.name).toBe("Анна Иванова");
      expect(f.client.phone).toBe("+995 555 11 22 33");
      expect(f.diagnostic).toBeNull();

      const [{ st0 }] = await tx`select trainer_diagnostics_state(${[e]}::uuid[]) as st0`;
      expect(st0[0].clients[0].diagnostic_id).toBeNull();

      const id = await save(tx, e, s.anna.id);
      const again = await save(tx, e, s.anna.id, { ...FORM, waist_cm: 62 });
      expect(again).toBe(id);

      const [{ st }] = await tx`select trainer_diagnostics_state(${[e]}::uuid[]) as st`;
      expect(st[0].clients[0].diagnostic_id).toBe(id);

      await asServer(tx);
      const [row] = await tx`select * from body_diagnostics where id = ${id}`;
      expect(Number(row.waist_cm)).toBe(62);
      expect(row.trainer_id).toBe(s.trainer);
      expect(row.trainer_name).toBe("Ольга Тренер");
      expect(row.forward_bend_cm).not.toBeNull();
      const [{ n }] = await tx`select count(*)::int as n from body_diagnostics where client_id = ${s.anna.id}`;
      expect(n).toBe(1);
    });
  });

  test("чужой тренер, не записанный клиент, обычный клиент — нельзя", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const e = await diagnostic(tx, s, 1);
      const stranger = await client(tx, s.studio, "Петрова");

      await as(tx, s.otherUser);
      expect(await failure(tx, () => save(tx, e, s.anna.id))).toContain("trainer_only");
      await as(tx, s.anna.user);
      expect(await failure(tx, () => save(tx, e, s.anna.id))).toContain("trainer_only");
      await as(tx, s.trainerUser);
      expect(await failure(tx, () => save(tx, e, stranger.id))).toContain("not_a_diagnostic");
      // Напрямую в таблицу не пишут.
      expect(
        await failure(
          tx,
          () => tx`insert into body_diagnostics (client_id, diagnostic_date) values (${s.anna.id}, current_date)`,
        ),
      ).toContain("permission denied");
    });
  });

  test("обязательные поля, лишние замеры при отказе, срок правки", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const e = await diagnostic(tx, s, 1);
      await as(tx, s.trainerUser);
      expect(await failure(tx, () => save(tx, e, s.anna.id, { ...FORM, goals: [] }))).toContain(
        "diagnostic_required:goals",
      );
      expect(
        await failure(tx, () => save(tx, e, s.anna.id, { ...FORM, restrictions: [] })),
      ).toContain("diagnostic_required:restrictions");
      const id = await save(tx, e, s.anna.id, {
        ...FORM,
        restrictions: [],
        no_restrictions: true,
        measure_skipped: true,
        forward_bend: "Ладони на полу",
      });
      await asServer(tx);
      const [row] = await tx`select * from body_diagnostics where id = ${id}`;
      expect(row.chest_cm).toBeNull();
      expect(row.weight_kg).toBeNull();
      expect(row.forward_bend_cm).toBeNull();

      // Прошло больше 14 дней — правка закрыта.
      const old = await diagnostic(tx, s, -24 * 15);
      await as(tx, s.trainerUser);
      expect(await failure(tx, () => save(tx, old, s.anna.id))).toContain("diagnostic_closed");
    });
  });

  test("незаполненные прошедшие — в списке, заполнили — ушли", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const past = await diagnostic(tx, s, -3);
      await diagnostic(tx, s, 5); // ещё впереди
      await diagnostic(tx, s, -24 * 9); // давно
      await as(tx, s.trainerUser);
      const todo = await tx`select * from trainer_diagnostics_todo() as id`;
      expect(todo.map((r: { id: string }) => r.id)).toEqual([past]);
      await save(tx, past, s.anna.id);
      const after = await tx`select * from trainer_diagnostics_todo() as id`;
      expect(after.length).toBe(0);
    });
  });

  test("клиент видит свои диагностики по порядку, с тренером; чужие — нет", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const first = await diagnostic(tx, s, -24 * 5);
      const second = await diagnostic(tx, s, -2);
      await as(tx, s.trainerUser);
      await save(tx, second, s.anna.id, { ...FORM, waist_cm: 61 });
      await save(tx, first, s.anna.id);

      await as(tx, s.anna.user);
      const [{ mine }] = await tx`select my_body_diagnostics() as mine`;
      expect(mine.length).toBe(2);
      expect(mine.map((d: { waist_cm: number }) => Number(d.waist_cm))).toEqual([64, 61]);
      expect(mine[0].trainer.full_name).toBe("Ольга Тренер");
      // Напрямую клиент таблицу не читает.
      const direct = await tx`select * from body_diagnostics`;
      expect(direct.length).toBe(0);

      await asServer(tx);
      const stranger = await client(tx, s.studio, "Петрова");
      await as(tx, stranger.user);
      const [{ none }] = await tx`select my_body_diagnostics() as none`;
      expect(none).toEqual([]);

      // Сотрудник клуба читает.
      await as(tx, s.admin);
      const staff = await tx`select id from body_diagnostics where client_id = ${s.anna.id}`;
      expect(staff.length).toBe(2);
    });
  });

  test("фото: только папка клиента, тренер диагностики пишет, клиент читает", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const e = await diagnostic(tx, s, 1);
      const path = `${s.anna.id}/a.webp`;
      // В заглушке storage прав, как у Supabase, нет — выдаём на сценарий.
      await tx`grant usage on schema storage to authenticated`;
      await tx`grant select, insert, delete on storage.objects to authenticated`;

      await as(tx, s.otherUser);
      expect(
        await failure(
          tx,
          () => tx`insert into storage.objects (bucket_id, name) values ('body-diagnostics', ${path})`,
        ),
      ).toContain("row-level security");

      await as(tx, s.trainerUser);
      await tx`insert into storage.objects (bucket_id, name) values ('body-diagnostics', ${path})`;
      expect(
        await failure(tx, () => save(tx, e, s.anna.id, { ...FORM, photo_paths: ["x/a.webp"] })),
      ).toContain("diagnostic_bad_photo");
      await save(tx, e, s.anna.id, { ...FORM, photo_paths: [path] });

      await as(tx, s.anna.user);
      const own = await tx`select name from storage.objects where bucket_id = 'body-diagnostics'`;
      expect(own.map((r: { name: string }) => r.name)).toEqual([path]);

      await as(tx, s.otherUser);
      const other = await tx`select name from storage.objects where bucket_id = 'body-diagnostics'`;
      expect(other.length).toBe(0);
    });
  });
});
