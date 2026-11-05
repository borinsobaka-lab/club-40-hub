/**
 * Тесты тренера в мобильном приложении (2026-11-05,
 * db/migrations/2026-11-05_zz_trainer_app.sql): связь «пользователь
 * приложения — тренер», «Моё расписание», записанные на занятие (пробные
 * первыми, цель, ограничения), анкета и комментарии тренеров — только
 * тренеру и только своих клиентов; пуши тренеру об отмене и замене.
 *
 * Нужна база с полной схемой — её собирает db/test/build-schema.sh:
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 * Без переменной тесты пропускаются. Каждый сценарий — в своей транзакции,
 * которая откатывается.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

describe.skipIf(!url)("тренер в приложении (база)", () => {
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

  async function client(tx: Tx, studio: string, last: string, withApp = true) {
    const userId = withApp ? await user(tx) : null;
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, full_name, email, user_id)
      values (${studio}, 'Анна', ${last}, ${`${last} Анна`}, ${`c-${crypto.randomUUID()}@example.com`}, ${userId})
      returning id`;
    return { id: id as string, user: userId };
  }

  type Seed = {
    studio: string;
    trainer: string;
    other: string;
    trainerUser: string;
    trainerCard: string;
    workout: string;
    admin: string;
  };

  async function seed(tx: Tx): Promise<Seed> {
    const [{ id: studio }] =
      await tx`insert into studios (name, format) values ('Ваке', 'packages') returning id`;
    const [{ id: trainer }] =
      await tx`insert into trainers (full_name, role) values ('Ольга Тренер', 'trainer') returning id`;
    const [{ id: other }] =
      await tx`insert into trainers (full_name, role) values ('Нино Тренер', 'trainer') returning id`;
    const [{ id: workout }] =
      await tx`insert into workouts (studio_id, name) values (${studio}, 'Стретчинг') returning id`;
    const card = await client(tx, studio, "Тренерова");
    const admin = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${admin}, ${studio}, 'admin')`;
    return {
      studio,
      trainer,
      other,
      trainerUser: card.user!,
      trainerCard: card.id,
      workout,
      admin,
    };
  }

  async function link(tx: Tx, s: Seed) {
    await as(tx, s.admin);
    await tx`insert into app_trainer_links (client_id, trainer_id) values (${s.trainerCard}, ${s.trainer})`;
    await asServer(tx);
  }

  async function entry(tx: Tx, s: Seed, hours: number, trainer = s.trainer) {
    const [{ id }] = await tx.unsafe(
      `insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at)
       values ($1, $2, 'group', now() + make_interval(hours => $3::int),
               now() + make_interval(hours => $3::int) + interval '1 hour')
       returning id`,
      [s.studio, s.workout, hours],
    );
    await tx`insert into schedule_entry_trainers (entry_id, trainer_id) values (${id}, ${trainer})`;
    return id as string;
  }

  async function book(tx: Tx, s: Seed, entryId: string, clientId: string) {
    await tx`
      insert into schedule_bookings (studio_id, entry_id, client_id, status)
      values (${s.studio}, ${entryId}, ${clientId}, 'booked')`;
  }

  async function sell(tx: Tx, s: Seed, clientId: string, kind: "trial" | "package") {
    const [{ id: m }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
      values (${s.studio}, ${kind === "trial" ? "Пробное" : "Пакет 8"}, ${kind},
              ${kind === "trial" ? 1 : 8}, 30, 100) returning id`;
    await tx`
      insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
      values (${s.studio}, ${clientId}, ${m}, 100, current_date, ${kind === "trial" ? "trial" : "new"})`;
  }

  test("не тренер: пусто и ошибка trainer_only", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      const e = await entry(tx, s, 5);
      await as(tx, s.trainerUser);
      const [{ me }] = await tx`select trainer_app_me() as me`;
      expect(me).toBeNull();
      const mine = await tx`select * from trainer_my_entries()`;
      expect(mine.length).toBe(0);
      expect(await failure(tx, () => tx`select * from trainer_entry_clients(${e})`)).toContain(
        "trainer_only",
      );
    });
  });

  test("моё расписание: свои будущие групповые по времени, без отменённых", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await link(tx, s);
      const later = await entry(tx, s, 30);
      const soon = await entry(tx, s, 3);
      await entry(tx, s, 4, s.other);
      const past = await entry(tx, s, -5);
      const cancelled = await entry(tx, s, 6);
      await tx`update schedule_entries set cancelled_at = now() where id = ${cancelled}`;

      await as(tx, s.trainerUser);
      const [{ me }] = await tx`select trainer_app_me() as me`;
      expect(me.trainer_id).toBe(s.trainer);
      const rows = await tx`select * from trainer_my_entries(0, 10) as id`;
      expect(rows.map((r: { id: string }) => r.id)).toEqual([soon, later]);
      expect(rows.map((r: { id: string }) => r.id)).not.toContain(past);
      const page2 = await tx`select * from trainer_my_entries(1, 10) as id`;
      expect(page2.map((r: { id: string }) => r.id)).toEqual([later]);
    });
  });

  test("записанные: пробные первыми, цель и ограничения; анкета и комментарии", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await link(tx, s);
      const e = await entry(tx, s, 5);
      const regular = await client(tx, s.studio, "Аалова");
      const trial = await client(tx, s.studio, "Яковлева");
      const stranger = await client(tx, s.studio, "Чужая");
      await sell(tx, s, regular.id, "package");
      await sell(tx, s, trial.id, "trial");
      await book(tx, s, e, regular.id);
      await book(tx, s, e, trial.id);
      await tx`
        insert into member_profiles (user_id, primary_goal, health_flags, health_notes, desired_frequency)
        values (${trial.user}, 'flexibility', '{back_joints}', 'Грыжа L5', 3),
               (${regular.user}, 'stress_relief', '{none}', null, 2)`;

      await as(tx, s.trainerUser);
      const rows = await tx`select * from trainer_entry_clients(${e})`;
      expect(rows.map((r: { client_id: string }) => r.client_id)).toEqual([trial.id, regular.id]);
      expect(rows[0].is_trial).toBe(true);
      expect(rows[0].has_restrictions).toBe(true);
      expect(rows[0].primary_goal).toBe("flexibility");
      expect(rows[1].is_trial).toBe(false);
      expect(rows[1].has_restrictions).toBe(false);

      const [{ p }] = await tx`select trainer_client_profile(${trial.id}) as p`;
      expect(p.profile.health_notes).toBe("Грыжа L5");
      expect(p.profile.desired_frequency).toBe(3);

      await tx`select trainer_add_comment(${trial.id}, '  Беречь спину  ')`;
      const comments = await tx`select * from trainer_client_comments(${trial.id})`;
      expect(comments.length).toBe(1);
      expect(comments[0].body).toBe("Беречь спину");
      expect(comments[0].author_name).toBe("Ольга Тренер");
      expect(comments[0].mine).toBe(true);
      const [again] = await tx`select * from trainer_entry_clients(${e}) where client_id = ${trial.id}`;
      expect(again.comments_count).toBe(1);
      expect(again.last_comment_author).toBe("Ольга Тренер");

      // Не записан на занятия этого тренера — ни анкеты, ни комментариев.
      expect(
        await failure(tx, () => tx`select trainer_client_profile(${stranger.id})`),
      ).toContain("trainer_only");
      expect(
        await failure(tx, () => tx`select trainer_add_comment(${stranger.id}, 'x')`),
      ).toContain("trainer_only");
      // Напрямую комментарий не записать.
      expect(
        await failure(
          tx,
          () =>
            tx`insert into trainer_comments (client_id, body) values (${trial.id}, 'x')`,
        ),
      ).not.toBeNull();
      // Связь с тренером клиент сам себе не ставит.
      expect(
        await failure(
          tx,
          () =>
            tx`insert into app_trainer_links (client_id, trainer_id) values (${s.trainerCard}, ${s.other})`,
        ),
      ).not.toBeNull();

      // Сотрудник клуба видит комментарии тренеров.
      await as(tx, s.admin);
      const seen = await tx`select body from trainer_comments where client_id = ${trial.id}`;
      expect(seen.length).toBe(1);
    });
  });

  test("один тренер — одна карточка", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await link(tx, s);
      const second = await client(tx, s.studio, "Вторая");
      await as(tx, s.admin);
      expect(
        await failure(
          tx,
          () =>
            tx`insert into app_trainer_links (client_id, trainer_id) values (${second.id}, ${s.trainer})`,
        ),
      ).toContain("app_trainer_links_trainer_key");
    });
  });

  async function pushes(tx: Tx, key: string) {
    return tx`
      select n.title, n.message, r.user_id
        from push_notifications n join push_recipients r on r.notification_id = n.id
       where n.trigger_key = ${key}`;
  }

  test("пуш тренеру: занятие отменено", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await link(tx, s);
      const e = await entry(tx, s, 5);
      await tx`update schedule_entries set cancelled_at = now() where id = ${e}`;
      const rows = await pushes(tx, "trainer_class_cancelled");
      expect(rows.length).toBe(1);
      expect(rows[0].user_id).toBe(s.trainerUser);
      expect(rows[0].message).toContain("«Стретчинг»");
      expect(rows[0].message).toContain("отменена");
      // Прошедшее занятие — без пуша.
      const old = await entry(tx, s, -3);
      await tx`update schedule_entries set cancelled_at = now() where id = ${old}`;
      expect((await pushes(tx, "trainer_class_cancelled")).length).toBe(1);
    });
  });

  test("пуш тренерам: замена — заменённому и заменяющему", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await link(tx, s);
      // Заменяющий тоже с приложением.
      const card = await client(tx, s.studio, "Нинова");
      await tx`insert into app_trainer_links (client_id, trainer_id) values (${card.id}, ${s.other})`;
      const e = await entry(tx, s, 5);
      // Как админка: новый тренер занятия, прежний убран, строка замены.
      await tx`insert into schedule_entry_trainers (entry_id, trainer_id) values (${e}, ${s.other})`;
      await tx`delete from schedule_entry_trainers where entry_id = ${e} and trainer_id = ${s.trainer}`;
      await tx`
        insert into schedule_entry_substitutions (entry_id, trainer_id, replaced_trainer_id)
        values (${e}, ${s.other}, ${s.trainer})`;

      const replaced = await pushes(tx, "trainer_replaced");
      expect(replaced.length).toBe(1);
      expect(replaced[0].user_id).toBe(s.trainerUser);
      expect(replaced[0].message).toContain("Нино Тренер");
      const sub = await pushes(tx, "trainer_substitute");
      expect(sub.length).toBe(1);
      expect(sub[0].user_id).toBe(card.user);
      expect(sub[0].message).toContain("вместо Ольга Тренер");

      // Выключенный триггер не шлёт.
      await tx`update push_triggers set enabled = false where key = 'trainer_class_cancelled'`;
      await tx`update schedule_entries set cancelled_at = now() where id = ${e}`;
      expect((await pushes(tx, "trainer_class_cancelled")).length).toBe(0);
    });
  });
});
