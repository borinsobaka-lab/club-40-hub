/**
 * Тесты запрета одинаковых почты и телефона у клиентов
 * (db/migrations/2026-11-12_zz_client_contacts_unique.sql): база пакетных
 * клубов общая, у подписочного клуба своя; номер в разной записи — один;
 * прежние совпадения не мешают править карточку; сам клиент, сервер и
 * функции владельца базы не останавливаются; подсказка формы
 * client_contact_check — только сотруднику.
 *
 * Нужна база с полной схемой:
 *   bash db/test/build-schema.sh postgres://postgres@localhost:5432/base40_test
 *   TEST_SCHEMA_DATABASE_URL=postgres://postgres@localhost:5432/base40_test bun test db
 * Без переменной тесты пропускаются. Каждый сценарий откатывается.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const url = process.env.TEST_SCHEMA_DATABASE_URL;

type Tx = SQL;

class Rollback extends Error {}

describe.skipIf(!url)("одинаковые почта и телефон клиентов (база)", () => {
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

  const mail = () => `u-${crypto.randomUUID()}@example.com`;

  async function account(tx: Tx): Promise<string> {
    await tx`set local session_replication_role = replica`;
    const [{ id }] = await tx`insert into auth.users (email) values (${mail()}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  async function studio(tx: Tx, format = "packages"): Promise<string> {
    const [{ id }] =
      await tx`insert into studios (name, format) values ('Клуб', ${format}) returning id`;
    return id as string;
  }

  async function staff(tx: Tx, studioId: string): Promise<string> {
    const id = await account(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${studioId}, 'admin')`;
    return id;
  }

  async function client(
    tx: Tx,
    studioId: string,
    c: { email?: string | null; phone?: string | null; phone2?: string | null; user?: string },
  ): Promise<string> {
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, full_name, email, phone, phone2, user_id)
      values (${studioId}, 'Анна', 'Тестова Анна', ${c.email ?? null}, ${c.phone ?? null},
              ${c.phone2 ?? null}, ${c.user ?? null})
      returning id`;
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

  test("пакетные клубы — общая база: почта и номер в любой записи заняты", () =>
    scenario(async (tx) => {
      const a = await studio(tx);
      const b = await studio(tx);
      const admin = await staff(tx, b);
      const email = mail();
      await client(tx, a, { email, phone: "+995591099719" });

      await as(tx, admin);
      const byEmail = await failure(tx, () =>
        client(tx, b, { email: ` ${email.toUpperCase()} ` }),
      );
      expect(byEmail).toContain("уже указан у клиента «Тестова Анна»");
      expect(await failure(tx, () => client(tx, b, { phone: "591 09 97 19" }))).toContain(
        "Телефон +995591099719",
      );
      expect(await failure(tx, () => client(tx, b, { phone2: "995591099719" }))).not.toBeNull();
      expect(await failure(tx, () => client(tx, b, { phone: "+995555112233" }))).toBeNull();
    }));

  test("подписочный клуб — своя база, другой формат — не мешает", () =>
    scenario(async (tx) => {
      const sub1 = await studio(tx, "subscription");
      const sub2 = await studio(tx, "subscription");
      const pack = await studio(tx);
      const admin1 = await staff(tx, sub1);
      const admin2 = await staff(tx, sub2);
      const adminP = await staff(tx, pack);
      await client(tx, sub1, { phone: "+995591099719" });

      await as(tx, admin1);
      expect(await failure(tx, () => client(tx, sub1, { phone: "+995591099719" }))).not.toBeNull();
      await as(tx, admin2);
      expect(await failure(tx, () => client(tx, sub2, { phone: "+995591099719" }))).toBeNull();
      await as(tx, adminP);
      expect(await failure(tx, () => client(tx, pack, { phone: "+995591099719" }))).toBeNull();
    }));

  test("прежнее совпадение не мешает править, новое — не сохранить", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      // Дубли, внесённые раньше (до запрета), — сервером.
      await client(tx, s, { phone: "+995591099719" });
      const dup = await client(tx, s, { phone: "+995591099719" });
      const other = await client(tx, s, { phone: "+995555112233", email: mail() });

      await as(tx, admin);
      expect(
        await failure(tx, () => tx`update clients set first_name = 'Мария' where id = ${dup}`),
      ).toBeNull();
      expect(
        await failure(tx, () => tx`update clients set phone = '591099719' where id = ${dup}`),
      ).toBeNull(); // тот же номер в другой записи
      expect(
        await failure(
          tx,
          () => tx`update clients set phone2 = '+995591099719' where id = ${other}`,
        ),
      ).not.toBeNull();
    }));

  test("сам клиент и сервер не останавливаются", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      await client(tx, s, { phone: "+995591099719" });
      const u = await account(tx);
      const own = await client(tx, s, { phone: "+995555112233", user: u });

      await as(tx, u);
      expect(
        await failure(tx, () => tx`update clients set phone = '+995591099719' where id = ${own}`),
      ).toBeNull();
      await asServer(tx);
      expect(await failure(tx, () => client(tx, s, { phone: "+995591099719" }))).toBeNull();
    }));

  test("client_contact_check — подсказка формы только сотруднику", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const email = mail();
      const c = await client(tx, s, { email, phone: "+995591099719" });
      const outsider = await account(tx);

      await as(tx, admin);
      const [{ r }] = await tx`
        select client_contact_check(${s}, null, ${email}, '591099719', null) as r`;
      expect((r as { field: string }[]).map((x) => x.field).sort()).toEqual(["email", "phone"]);
      const [{ r: self }] = await tx`
        select client_contact_check(${s}, ${c}, ${email}, '591099719', null) as r`;
      expect(self).toEqual([]);

      await as(tx, outsider);
      const [{ r: none }] = await tx`
        select client_contact_check(${s}, null, ${email}, null, null) as r`;
      expect(none).toEqual([]);
    }));
});
