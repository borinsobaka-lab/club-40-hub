/**
 * Оплата групповых по числу людей и бонус тренеру пробного
 * (db/migrations/2026-11-11_studio_per_person_pay.sql): схемы клуба,
 * расчёт строк payroll_lines, 5 % тренеру при продаже не идёт.
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

describe.skipIf(!url)("оплата групповых по числу людей (база)", () => {
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

  const BONUSES = JSON.stringify([
    { from: 7, amount: 5 },
    { from: 10, amount: 10 },
  ]);

  type Club = { studio: string; coach: string; mat: string; trx: string; other: string };

  /** Клуб с владельцем-вызывающим, тренером, тремя тренировками и схемами «Коврик» (по умолчанию) и TRX. */
  async function club(tx: Tx, settings = true): Promise<Club> {
    const [{ id: studio }] = await tx`
      insert into studios (name, format) values ('Палиашвили', 'packages') returning id`;
    await tx`set local session_replication_role = replica`;
    const [{ id: uid }] = await tx`
      insert into auth.users (email) values (${`owner-${studio}@example.com`}) returning id`;
    await tx`set local session_replication_role = origin`;
    await tx`insert into user_roles (user_id, studio_id, role) values (${uid}, ${studio}, 'owner')`;
    await tx`select set_config('request.jwt.claim.sub', ${uid}::text, true)`;

    const [{ id: coach }] = await tx`
      insert into trainers (full_name, role) values ('Тренер', 'trainer') returning id`;
    await tx`insert into trainer_studios (trainer_id, studio_id) values (${coach}, ${studio})`;
    await tx`
      insert into trainer_pay_rates (trainer_id, group_training_enabled, group_training_rate)
      values (${coach}, true, 30)`;
    const workout = async (name: string) => {
      const [{ id }] = await tx`
        insert into workouts (studio_id, name) values (${studio}, ${name}) returning id`;
      return id as string;
    };
    const mat = await workout("Стретчинг");
    const trx = await workout("TRX");
    const other = await workout("Пилатес");

    if (settings) {
      await tx`insert into studio_pay_settings (studio_id, per_person, trial_sale_bonus)
               values (${studio}, true, 10)`;
      await tx`
        insert into studio_pay_schemes (studio_id, name, is_default, min_amount, min_up_to, per_person, bonuses)
        values (${studio}, 'Обычная группа', true, 15, 3, 4, (${BONUSES}::text)::jsonb)`;
      const [{ id: trxScheme }] = await tx`
        insert into studio_pay_schemes (studio_id, name, min_amount, min_up_to, per_person, bonuses)
        values (${studio}, 'TRX', 15, 3, 6, (${BONUSES}::text)::jsonb) returning id`;
      await tx`insert into studio_pay_scheme_workouts (scheme_id, workout_id) values (${trxScheme}, ${trx})`;
    }
    return { studio, coach, mat, trx, other };
  }

  /** Прошедшее групповое занятие тренера с attended «Посетил» и noShow «Не пришёл». */
  async function lesson(tx: Tx, c: Club, workout: string, attended: number, noShow = 0) {
    const [{ id: e }] = await tx`
      insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at)
      values (${c.studio}, ${workout}, 'group', now() - interval '3 hours', now() - interval '2 hours')
      returning id`;
    await tx`insert into schedule_entry_trainers (entry_id, trainer_id) values (${e}, ${c.coach})`;
    // Статусы ставим без триггеров списания: в этих тестах важен только подсчёт людей.
    await tx`set local session_replication_role = replica`;
    for (let i = 0; i < attended + noShow; i++) {
      const [{ id: cl }] = await tx`
        insert into clients (studio_id, first_name, last_name, full_name)
        values (${c.studio}, 'К', ${String(i)}, ${`К ${i}`})
        returning id`;
      await tx`
        insert into schedule_bookings (studio_id, entry_id, client_id, status)
        values (${c.studio}, ${e}, ${cl}, ${i < attended ? "attended" : "no_show"})`;
    }
    await tx`set local session_replication_role = origin`;
    return e as string;
  }

  async function lessonsPay(tx: Tx, c: Club) {
    const [{ sum }] = await tx`
      select coalesce(sum(amount), 0)::numeric as sum
        from payroll_lines(current_date - 1, current_date)
       where trainer_id = ${c.coach} and kind = 'group'`;
    return Number(sum);
  }

  test("пример старшего тренера: TRX 2, 7, 5, 4, 3 человека", async () => {
    await scenario(async (tx) => {
      const c = await club(tx);
      for (const n of [2, 7, 5, 4, 3]) await lesson(tx, c, c.trx, n);
      // 15 + (42 + 5 за наполняемость) + 30 + 24 + 15
      expect(await lessonsPay(tx, c)).toBe(131);
    });
  });

  test("коврик: схема по умолчанию для тренировок без своей; считаются только «Посетил»", async () => {
    await scenario(async (tx) => {
      const c = await club(tx);
      await lesson(tx, c, c.mat, 3, 4); // 3 пришли, 4 не пришли → минимум 15
      await lesson(tx, c, c.other, 10); // 40 + 10
      expect(await lessonsPay(tx, c)).toBe(15 + 50);
    });
  });

  test("клуб без настройки — прежняя ставка сотрудника", async () => {
    await scenario(async (tx) => {
      const c = await club(tx, false);
      await lesson(tx, c, c.trx, 7);
      expect(await lessonsPay(tx, c)).toBe(30);
    });
  });

  test("+10 ₾ тренеру пробного за абонемент после пробного, вместо 5 % тренеру при продаже", async () => {
    await scenario(async (tx) => {
      const c = await club(tx);
      const [{ id: client }] = await tx`
        insert into clients (studio_id, first_name, last_name) values (${c.studio}, 'Анна', 'Пробная')
        returning id`;
      const [{ id: trial }] = await tx`
        insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
        values (${c.studio}, 'Пробное', 'trial', 1, 30, 20) returning id`;
      const [{ id: pack }] = await tx`
        insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
        values (${c.studio}, 'Пакет 8', 'package', 8, 30, 200) returning id`;
      await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
        values (${c.studio}, ${client}, ${trial}, 20, current_date - 1, 'trial')`;
      const [{ id: e }] = await tx`
        insert into schedule_entries (studio_id, workout_id, kind, starts_at, ends_at)
        values (${c.studio}, ${c.mat}, 'group', now() - interval '26 hours', now() - interval '25 hours')
        returning id`;
      await tx`insert into schedule_entry_trainers (entry_id, trainer_id) values (${e}, ${c.coach})`;
      const [{ id: b }] = await tx`
        insert into schedule_bookings (studio_id, entry_id, client_id, status)
        values (${c.studio}, ${e}, ${client}, 'booked') returning id`;
      await tx`update schedule_bookings set status = 'attended' where id = ${b}`;

      // Купила пакет — тренер при продаже тот же, но 5 % ему не идут.
      await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind, trainer_id)
        values (${c.studio}, ${client}, ${pack}, 200, current_date, 'new', ${c.coach})`;
      // Вторая покупка — бонус один на клиента.
      await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
        values (${c.studio}, ${client}, ${pack}, 200, current_date, 'renewal')`;

      const rows = await tx`
        select kind, units, amount::numeric as amount
          from payroll_lines(current_date - 2, current_date)
         where trainer_id = ${c.coach} and kind in ('trial_bonus', 'sale')`;
      expect(rows.map((r: { kind: string; amount: string }) => [r.kind, Number(r.amount)])).toEqual(
        [["trial_bonus", 10]],
      );
    });
  });
});
