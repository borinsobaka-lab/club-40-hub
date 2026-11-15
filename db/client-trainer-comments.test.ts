/**
 * Тесты комментариев клиентов о тренерах
 * (db/migrations/2026-11-14_client_trainer_comments.sql): клиент оставляет
 * комментарий от имени или анонимно, он ждёт модерации в «Обратной связи»,
 * в карточке тренера видны только опубликованные — без автора у анонимных и
 * без user_id у всех.
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

describe.skipIf(!url)("комментарии клиентов о тренерах (база)", () => {
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

  async function as(tx: Tx, userId: string) {
    await tx`reset role`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}::text, true)`;
    await tx`set local role authenticated`;
  }

  async function asServer(tx: Tx) {
    await tx`reset role`;
    await tx`select set_config('request.jwt.claim.sub', '', true)`;
  }

  async function client(tx: Tx, studio: string, first: string, last: string) {
    const userId = await user(tx);
    await tx`
      insert into clients (studio_id, first_name, last_name, full_name, email, user_id)
      values (${studio}, ${first}, ${last}, ${`${first} ${last}`},
              ${`c-${crypto.randomUUID()}@example.com`}, ${userId})`;
    return userId;
  }

  async function seed(tx: Tx) {
    const [{ id: studio }] =
      await tx`insert into studios (name, format) values ('Ваке', 'packages') returning id`;
    const [{ id: trainer }] =
      await tx`insert into trainers (full_name, role) values ('Ольга Тренер', 'trainer') returning id`;
    await tx`insert into trainer_studios (trainer_id, studio_id) values (${trainer}, ${studio})`;
    // Тренер чужого клуба другого формата — клиенту не виден.
    const [{ id: farStudio }] =
      await tx`insert into studios (name, format) values ('Далеко', 'subscription') returning id`;
    const [{ id: farTrainer }] =
      await tx`insert into trainers (full_name, role) values ('Чужой Тренер', 'trainer') returning id`;
    await tx`insert into trainer_studios (trainer_id, studio_id) values (${farTrainer}, ${farStudio})`;
    const admin = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${admin}, ${studio}, 'admin')`;
    await tx`insert into profiles (id, studio_id, full_name) values (${admin}, ${studio}, 'Админ Ника')
             on conflict (id) do update set full_name = excluded.full_name`;
    const anna = await client(tx, studio, "Анна", "Курочкина");
    const maria = await client(tx, studio, "Мария", "Иванова");
    return { studio, trainer, farTrainer, admin, anna, maria };
  }

  test("от имени: на модерации, имя из карточки, клуб и статус не подделать", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await as(tx, s.anna);
      await tx`
        insert into client_trainer_comments
          (trainer_id, message, status, author_name, author_public, studio_id, user_id, created_at)
        values (${s.trainer}, '  Лучший тренер!  ', 'approved', 'Кто-то', 'Кто-то', null, ${s.maria}, '2020-01-01')`;
      const [own] = await tx`select * from client_trainer_comments`;
      expect(own.status).toBe("pending");
      expect(own.user_id).toBe(s.anna);
      expect(own.message).toBe("Лучший тренер!");
      expect(own.author_name).toBe("Анна Курочкина");
      expect(own.author_public).toBe("Анна К.");
      expect(own.studio_id).toBe(s.studio);
      expect(new Date(own.created_at).getFullYear()).toBeGreaterThan(2020);

      // Пока на модерации — в карточке тренера пусто, и второй не отправить.
      expect(await tx`select * from client_trainer_comments_published(${s.trainer})`).toHaveLength(
        0,
      );
      expect(
        await failure(
          tx,
          () =>
            tx`insert into client_trainer_comments (trainer_id, message) values (${s.trainer}, 'Ещё')`,
        ),
      ).toContain("client_trainer_comment_pending");

      // Модерировать сам клиент не может: обновление его строки не задевает.
      await tx`update client_trainer_comments set status = 'approved'`;
      await asServer(tx);
      const [still] = await tx`select status from client_trainer_comments where id = ${own.id}`;
      expect(still.status).toBe("pending");
    });
  });

  test("анонимно: имени нет нигде, в карточке — без автора", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await as(tx, s.anna);
      await tx`
        insert into client_trainer_comments (trainer_id, message, is_anonymous, author_name)
        values (${s.trainer}, 'Тихо и по делу', true, 'Анна')`;
      await as(tx, s.admin);
      const [row] = await tx`select * from client_trainer_comments`;
      expect(row.is_anonymous).toBe(true);
      expect(row.author_name).toBeNull();
      expect(row.author_public).toBeNull();
      await tx`update client_trainer_comments set status = 'approved' where id = ${row.id}`;

      await as(tx, s.maria);
      const published = await tx`select * from client_trainer_comments_published(${s.trainer})`;
      expect(published).toHaveLength(1);
      expect(published[0].author).toBeNull();
      expect(Object.keys(published[0])).not.toContain("user_id");
      // Саму строку чужого комментария клиент не читает.
      expect(await tx`select * from client_trainer_comments`).toHaveLength(0);
    });
  });

  test("модерация: опубликовать, отклонить, снять — кто и когда пишет база", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await as(tx, s.anna);
      await tx`insert into client_trainer_comments (trainer_id, message) values (${s.trainer}, 'Спасибо!')`;

      await as(tx, s.admin);
      const [row] = await tx`select id from client_trainer_comments`;
      // Текст и автора модератор не меняет — только статус.
      await tx`
        update client_trainer_comments
           set status = 'approved', message = 'Подправлено', author_public = 'Другая',
               moderated_by_name = 'Не я'
         where id = ${row.id}`;
      const [ok] = await tx`select * from client_trainer_comments where id = ${row.id}`;
      expect(ok.status).toBe("approved");
      expect(ok.message).toBe("Спасибо!");
      expect(ok.author_public).toBe("Анна К.");
      expect(ok.moderated_by).toBe(s.admin);
      expect(ok.moderated_by_name).toBe("Админ Ника");
      expect(ok.moderated_at).not.toBeNull();

      await as(tx, s.maria);
      const shown = await tx`select * from client_trainer_comments_published(${s.trainer})`;
      expect(shown.map((r: { author: string }) => r.author)).toEqual(["Анна К."]);

      // После решения модератора автор может написать следующий.
      await as(tx, s.anna);
      await tx`insert into client_trainer_comments (trainer_id, message) values (${s.trainer}, 'И ещё раз спасибо')`;
      expect(await tx`select * from client_trainer_comments`).toHaveLength(2);

      await as(tx, s.admin);
      await tx`update client_trainer_comments set status = 'rejected' where id = ${row.id}`;
      await as(tx, s.maria);
      expect(await tx`select * from client_trainer_comments_published(${s.trainer})`).toHaveLength(
        0,
      );

      await as(tx, s.admin);
      await tx`update client_trainer_comments set status = 'pending' where id = ${row.id}`;
      const [back] = await tx`select * from client_trainer_comments where id = ${row.id}`;
      expect(back.moderated_by).toBeNull();
      expect(back.moderated_at).toBeNull();

      // Клиент не удаляет, сотрудник — удаляет.
      await as(tx, s.anna);
      await tx`delete from client_trainer_comments`;
      await as(tx, s.admin);
      expect(await tx`select * from client_trainer_comments`).toHaveLength(2);
      await tx`delete from client_trainer_comments where id = ${row.id}`;
      expect(await tx`select * from client_trainer_comments`).toHaveLength(1);
    });
  });

  test("о тренере, которого клиент не видит, — нельзя; опубликованные чужого — пусто", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await as(tx, s.anna);
      expect(
        await failure(
          tx,
          () =>
            tx`insert into client_trainer_comments (trainer_id, message) values (${s.farTrainer}, 'Привет')`,
        ),
      ).toContain("row-level security");
      expect(
        await failure(
          tx,
          () =>
            tx`insert into client_trainer_comments (trainer_id, message) values (${s.trainer}, '   ')`,
        ),
      ).toContain("client_trainer_comments_lengths_check");

      await asServer(tx);
      await tx`
        insert into client_trainer_comments (trainer_id, message, status)
        values (${s.farTrainer}, 'Опубликовано', 'approved')`;
      await as(tx, s.anna);
      expect(
        await tx`select * from client_trainer_comments_published(${s.farTrainer})`,
      ).toHaveLength(0);
    });
  });

  test("число опубликованных для списка тренеров — только видимым тренерам", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await asServer(tx);
      await tx`
        insert into client_trainer_comments (trainer_id, message, status)
        values (${s.trainer}, 'Раз', 'approved'), (${s.trainer}, 'Два', 'approved'),
               (${s.trainer}, 'Ждёт', 'pending'), (${s.trainer}, 'Нет', 'rejected'),
               (${s.farTrainer}, 'Чужой', 'approved')`;
      await as(tx, s.anna);
      const rows = await tx`
        select * from client_trainer_comment_counts(${[s.trainer, s.farTrainer]}::uuid[])`;
      expect(
        rows.map((r: { trainer_id: string; comments_count: number }) => [
          r.trainer_id,
          r.comments_count,
        ]),
      ).toEqual([[s.trainer, 2]]);
      await as(tx, s.admin);
      const staff = await tx`
        select * from client_trainer_comment_counts(${[s.trainer, s.farTrainer]}::uuid[])
         order by comments_count`;
      expect(staff.map((r: { comments_count: number }) => r.comments_count)).toEqual([1, 2]);
    });
  });

  test("удаление учётной записи приложения стирает комментарии клиента", async () => {
    await scenario(async (tx) => {
      const s = await seed(tx);
      await as(tx, s.anna);
      await tx`insert into client_trainer_comments (trainer_id, message) values (${s.trainer}, 'Моё')`;
      await asServer(tx);
      await tx`select public.wipe_client_app_account(${s.anna}::uuid)`;
      expect(
        await tx`select * from client_trainer_comments where trainer_id = ${s.trainer}`,
      ).toHaveLength(0);
    });
  });
});
