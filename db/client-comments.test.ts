/**
 * Тесты ленты комментариев клиента (db/migrations/2026-11-01_zzzzz_client_comments.sql):
 * кто видит и пишет, автор и время — от базы, правка и удаление только своего,
 * абонемент — только этого клиента, сводка client_comment_stats, прежние поля
 * clients.notes / sales.comment / sales.membership_note попадают в ленту,
 * переоформление абонемента уносит его комментарии.
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

describe.skipIf(!url)("комментарии клиента (база)", () => {
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

  async function studio(tx: Tx, format = "packages"): Promise<string> {
    const [{ id }] =
      await tx`insert into studios (name, format) values ('Тест', ${format}) returning id`;
    return id as string;
  }

  async function staff(tx: Tx, studioId: string, name: string): Promise<string> {
    const id = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${studioId}, 'admin')`;
    await tx`insert into profiles (id, studio_id, full_name) values (${id}, ${studioId}, ${name})
             on conflict (id) do update set full_name = excluded.full_name`;
    return id;
  }

  async function client(tx: Tx, studioId: string, notes: string | null = null): Promise<string> {
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, full_name, email, notes)
      values (${studioId}, 'Анна', 'Тестова', 'Тестова Анна',
              ${`c-${crypto.randomUUID()}@example.com`}, ${notes})
      returning id`;
    return id as string;
  }

  async function sell(tx: Tx, studioId: string, clientId: string, comment: string | null = null) {
    const [{ id: m }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
      values (${studioId}, 'Пакет 8', 'package', 8, 30, 100) returning id`;
    const [{ id }] = await tx`
      insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind, comment)
      values (${studioId}, ${clientId}, ${m}, 100, current_date, 'new', ${comment})
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

  test("автор и время ставит база, видят сотрудники сети, чужой клуб — нет", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const s2 = await studio(tx); // тоже пакетный — сеть
      const sub = await studio(tx, "subscription");
      const anna = await staff(tx, s, "Анна Админ");
      const net = await staff(tx, s2, "Сеть Сотрудник");
      const stranger = await staff(tx, sub, "Чужой");
      const c = await client(tx, s);
      const other = await user(tx);

      await as(tx, anna);
      const [row] = await tx`
        insert into client_comments (client_id, body, author_id, author_name, created_at, kind)
        values (${c}, '  Звонила, ждёт продления  ', ${anna}, 'Подделка', '2020-01-01', 'imported')
        returning author_id, author_name, created_at, kind, body, studio_id`;
      expect(row.author_id).toBe(anna);
      expect(row.author_name).toBe("Анна Админ");
      expect(row.kind).toBe("note");
      expect(row.body).toBe("Звонила, ждёт продления");
      expect(row.studio_id).toBe(s);
      expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2020);

      // Чужим именем не написать: автор — всегда вошедший.
      const [forged] = await tx`
        insert into client_comments (client_id, body, author_id) values (${c}, 'x', ${net})
        returning author_id`;
      expect(forged.author_id).toBe(anna);

      await as(tx, net);
      expect((await tx`select id from client_comments where client_id = ${c}`).length).toBe(2);
      await tx`insert into client_comments (client_id, body) values (${c}, 'Из другого клуба сети')`;

      for (const who of [stranger, other]) {
        await as(tx, who);
        expect((await tx`select id from client_comments where client_id = ${c}`).length).toBe(0);
        expect(
          await failure(tx, () => tx`insert into client_comments (client_id, body) values (${c}, 'x')`),
        ).toContain("row-level security");
      }
      await asServer(tx);
    }));

  test("правка и удаление — только своего; перенесённый — любой сотрудник", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const anna = await staff(tx, s, "Анна");
      const olga = await staff(tx, s, "Ольга");
      const c = await client(tx, s);
      await as(tx, anna);
      const [{ id }] =
        await tx`insert into client_comments (client_id, body) values (${c}, 'Первый') returning id`;

      await as(tx, olga);
      await tx`update client_comments set body = 'Взлом' where id = ${id}`;
      await tx`delete from client_comments where id = ${id}`;
      await as(tx, anna);
      const [kept] = await tx`select body, edited_at from client_comments where id = ${id}`;
      expect(kept.body).toBe("Первый");
      expect(kept.edited_at).toBeNull();

      await tx`update client_comments set body = 'Исправлен', author_name = 'Ольга', client_id = ${c} where id = ${id}`;
      const [edited] = await tx`select body, author_name, edited_at from client_comments where id = ${id}`;
      expect(edited.body).toBe("Исправлен");
      expect(edited.author_name).toBe("Анна");
      expect(edited.edited_at).not.toBeNull();

      // Пустой текст — нельзя.
      expect(await failure(tx, () => tx`update client_comments set body = '   ' where id = ${id}`)).toContain(
        "client_comments_body_check",
      );

      await asServer(tx);
      const [{ id: legacy }] = await tx`
        insert into client_comments (client_id, kind, body, created_at)
        values (${c}, 'imported', 'Старое поле', '2026-01-01') returning id`;
      await as(tx, olga);
      await tx`update client_comments set body = 'Старое поле, поправлено' where id = ${legacy}`;
      const [l] = await tx`select body, author_id, kind from client_comments where id = ${legacy}`;
      expect(l.body).toBe("Старое поле, поправлено");
      expect(l.author_id).toBeNull();
      expect(l.kind).toBe("imported");
      await tx`delete from client_comments where id = ${legacy}`;
      await tx`delete from client_comments where id = ${id}`; // чужой — не удалится
      await asServer(tx);
      expect((await tx`select id from client_comments where client_id = ${c}`).length).toBe(1);
    }));

  test("абонемент — только этого клиента; сводка считает клиента вместе с абонементами", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const anna = await staff(tx, s, "Анна");
      const c = await client(tx, s);
      const c2 = await client(tx, s);
      const sale = await sell(tx, s, c);
      const sale2 = await sell(tx, s, c2);

      await as(tx, anna);
      expect(
        await failure(
          tx,
          () => tx`insert into client_comments (client_id, sale_id, body) values (${c}, ${sale2}, 'x')`,
        ),
      ).toContain("не принадлежит");
      await tx`insert into client_comments (client_id, body) values (${c}, 'О клиенте')`;
      await tx`insert into client_comments (client_id, sale_id, body) values (${c}, ${sale}, 'Об абонементе')`;

      const stats = await tx`select * from client_comment_stats(${[c, c2]}::uuid[])`;
      expect(stats.length).toBe(1);
      expect(stats[0].client_id).toBe(c);
      expect(stats[0].comments_count).toBe(2);
      expect(stats[0].last_author).toBe("Анна");
      expect(stats[0].last_body).toBe("Об абонементе");
      expect(stats[0].last_sale_id).toBe(sale);
      await asServer(tx);
    }));

  test("прежние поля дописываются в ленту; переоформление уносит комментарии абонемента", () =>
    scenario(async (tx) => {
      const s = await studio(tx);
      const anna = await staff(tx, s, "Анна");
      await as(tx, anna);
      const c = await client(tx, s, "Заметка при создании");
      const c2 = await client(tx, s);
      const sale = await sell(tx, s, c, "Скидка по акции");
      await tx`update sales set membership_note = 'Доплатит 10-го' where id = ${sale}`;
      await tx`update sales set membership_note = 'Доплатит 10-го' where id = ${sale}`; // тот же текст
      await tx`update clients set notes = null where id = ${c}`; // стёрли — лента не трогается

      const rows = await tx`
        select kind, body, sale_id, author_name from client_comments
         where client_id = ${c} order by created_at, body`;
      expect(rows.map((r: { body: string }) => r.body).sort()).toEqual(
        ["Доплатит 10-го", "Заметка при создании", "Скидка по акции"].sort(),
      );
      expect(rows.find((r: { body: string }) => r.body === "Скидка по акции").kind).toBe("sale");
      expect(rows.every((r: { author_name: string }) => r.author_name === "Анна")).toBe(true);

      await asServer(tx);
      await tx`update sales set client_id = ${c2} where id = ${sale}`;
      expect((await tx`select id from client_comments where client_id = ${c}`).length).toBe(1);
      expect((await tx`select id from client_comments where client_id = ${c2}`).length).toBe(2);

      // Продажу удалили — комментарии остаются у клиента.
      await tx`delete from client_memberships where sale_id = ${sale}`;
      await tx`delete from sales where id = ${sale}`;
      const left = await tx`select sale_id from client_comments where client_id = ${c2}`;
      expect(left.length).toBe(2);
      expect(left.every((r: { sale_id: string | null }) => r.sale_id === null)).toBe(true);
    }));
});
