/**
 * Тесты смены почты и телефона в карточке клиента
 * (db/migrations/2026-11-12_client_contact_account_sync.sql): учётная запись
 * карточки получает новую почту, устаревший телефон снимается, при занятой
 * почте и у сотрудника карточка отвязывается, клиент сам себе почту учётной
 * записи не меняет, по телефону учётная запись с карточками не находится.
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

describe.skipIf(!url)("смена почты и телефона клиента (база)", () => {
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

  const mail = () => `u-${crypto.randomUUID()}@example.com`;

  async function account(tx: Tx, email: string | null, phone: string | null = null) {
    await tx`set local session_replication_role = replica`;
    const [{ id }] =
      await tx`insert into auth.users (email, phone) values (${email}, ${phone}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  async function studio(tx: Tx, format = "packages"): Promise<string> {
    const [{ id }] =
      await tx`insert into studios (name, format) values ('Тест', ${format}) returning id`;
    return id as string;
  }

  async function staff(tx: Tx, studioId: string, email = mail()): Promise<string> {
    const id = await account(tx, email);
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${studioId}, 'admin')`;
    return id;
  }

  async function client(
    tx: Tx,
    studioId: string,
    email: string | null,
    userId: string | null,
    phone: string | null = null,
  ): Promise<string> {
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, full_name, email, phone, user_id)
      values (${studioId}, 'Анна', 'Тестова', 'Тестова Анна', ${email}, ${phone}, ${userId})
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

  async function accountOf(tx: Tx, id: string) {
    const [u] = await tx`select email, phone from auth.users where id = ${id}`;
    return u as { email: string | null; phone: string | null };
  }
  async function linkOf(tx: Tx, clientId: string) {
    const [c] = await tx`select user_id from clients where id = ${clientId}`;
    return c.user_id as string | null;
  }

  test("сотрудник меняет почту — у учётной записи та же новая почта, вход разрешён", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const old = mail();
      const u = await account(tx, old);
      const c = await client(tx, s, old, u);
      const fresh = mail();

      await as(tx, admin);
      await tx`update clients set email = ${" " + fresh.toUpperCase()} where id = ${c}`;
      await asServer(tx);

      expect((await accountOf(tx, u)).email).toBe(fresh);
      expect(await linkOf(tx, c)).toBe(u);
      const [{ ok }] = await tx`select client_app_sign_in_allowed(${u}) as ok`;
      expect(ok).toBe(true);
    }));

  test("клиент, входивший по телефону, — дописанная почта становится почтой учётной записи", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const u = await account(tx, null, "995591099719");
      const c = await client(tx, s, null, u, "591099719");
      const fresh = mail();

      await as(tx, admin);
      await tx`update clients set email = ${fresh} where id = ${c}`;
      await asServer(tx);

      const acc = await accountOf(tx, u);
      expect(acc.email).toBe(fresh);
      expect(acc.phone).toBe("995591099719"); // номер в карточке тот же
    }));

  test("почта занята другой учётной записью — карточка отвязывается и придёт к ней", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const old = mail();
      const u = await account(tx, old);
      const c = await client(tx, s, old, u);
      const taken = mail();
      const other = await account(tx, taken);

      await as(tx, admin);
      await tx`update clients set email = ${taken} where id = ${c}`;
      await asServer(tx);

      expect((await accountOf(tx, u)).email).toBe(old);
      expect(await linkOf(tx, c)).toBeNull();
      const [{ ok }] = await tx`select client_app_sign_in_allowed(${other}) as ok`;
      expect(ok).toBe(true);
    }));

  test("учётная запись сотрудника — почту не меняем, карточку отвязываем", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const staffMail = mail();
      const colleague = await staff(tx, s, staffMail);
      const c = await client(tx, s, staffMail, colleague);
      const fresh = mail();

      await as(tx, admin);
      await tx`update clients set email = ${fresh} where id = ${c}`;
      await asServer(tx);

      expect((await accountOf(tx, colleague)).email).toBe(staffMail);
      expect(await linkOf(tx, c)).toBeNull();
    }));

  test("вторая карточка со старой почтой — меняется только связь изменённой", () =>
    scenario(async (tx) => {
      const pack = await studio(tx);
      const sub = await studio(tx, "subscription");
      const admin = await staff(tx, pack);
      const old = mail();
      const u = await account(tx, old);
      const keep = await client(tx, sub, old, u);
      const c = await client(tx, pack, old, u);

      await as(tx, admin);
      await tx`update clients set email = ${mail()} where id = ${c}`;
      await asServer(tx);

      expect((await accountOf(tx, u)).email).toBe(old);
      expect(await linkOf(tx, keep)).toBe(u);
      expect(await linkOf(tx, c)).toBeNull();
    }));

  test("клиент сам меняет почту в приложении — учётная запись не меняется", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const old = mail();
      const u = await account(tx, old);
      const c = await client(tx, s, old, u);

      await as(tx, u);
      await tx`update clients set email = ${mail()} where id = ${c}`;
      await asServer(tx);

      expect((await accountOf(tx, u)).email).toBe(old);
    }));

  test("номер в карточке сменили — старый снят с учётной записи и её не находит", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const admin = await staff(tx, s);
      const u = await account(tx, mail(), "995591099719");
      const c = await client(tx, s, null, u, "+995 591 09 97 19");

      // Номер в другом виде — тот же, не трогаем.
      await as(tx, admin);
      await tx`update clients set phone = '591099719' where id = ${c}`;
      await asServer(tx);
      expect((await accountOf(tx, u)).phone).toBe("995591099719");

      await as(tx, admin);
      await tx`update clients set phone = '+995 555 11 22 33' where id = ${c}`;
      await asServer(tx);
      expect((await accountOf(tx, u)).phone).toBeNull();
      expect(await linkOf(tx, c)).toBe(u);
    }));

  test("по одному номеру учётная запись с карточками не находится", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const linked = await account(tx, null, "995591099719");
      await client(tx, s, null, linked, "591099719");
      const [{ id: found }] =
        await tx`select phone_login_account(null, '+995591099719') as id`;
      expect(found).toBeNull();

      const orphan = await account(tx, null, "995555112233");
      const [{ id: free }] = await tx`select phone_login_account(null, '+995555112233') as id`;
      expect(free).toBe(orphan);
    }));
});
