/**
 * Тесты CRM, этап 1 (db/migrations/2026-11-17_zzz_crm_core.sql): кто видит
 * раздел и сделки, закрывающие этапы воронки, события ленты, комментарии
 * (только свои правятся), задачи, перенос сделок при удалении этапа, связь
 * контакта с карточкой клиента.
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

describe.skipIf(!url)("CRM (база)", () => {
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

  async function studio(tx: Tx, name = "Тест"): Promise<string> {
    const [{ id }] =
      await tx`insert into studios (name, format) values (${name}, 'packages') returning id`;
    return id as string;
  }

  /** Сотрудник клуба; rights — сетевые права в новой модели (null — вне модели). */
  async function staff(
    tx: Tx,
    studioId: string,
    role: string,
    name: string,
    rights: string[] | null,
  ): Promise<string> {
    const id = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${studioId}, ${role}::app_role)`;
    await tx`insert into profiles (id, studio_id, full_name) values (${id}, ${studioId}, ${name})
             on conflict (id) do update set full_name = excluded.full_name`;
    if (rights) {
      await tx`set local session_replication_role = replica`;
      await tx`insert into access_user_rights (user_id, portal, rights)
               values (${id}, true, ${tx.array(rights, "text")})`;
      await tx`set local session_replication_role = origin`;
    }
    return id;
  }

  async function as(tx: Tx, userId: string) {
    await tx`select set_config('request.jwt.claim.sub', ${userId}::text, true)`;
    await tx`set local role authenticated`;
  }
  async function asServer(tx: Tx) {
    await tx`reset role`;
    await tx`select set_config('request.jwt.claim.sub', '', true)`;
  }

  async function setup(tx: Tx) {
    const s1 = await studio(tx, "Ваке");
    const s2 = await studio(tx, "Сабуртало");
    const manager = await staff(tx, s1, "admin", "Марина Менеджер", ["crm.view", "crm.manage"]);
    const admin1 = await staff(tx, s1, "admin", "Анна Админ", ["crm.view"]);
    const admin2 = await staff(tx, s2, "admin", "Нино Админ", ["crm.view"]);
    const noCrm = await staff(tx, s1, "admin", "Без CRM", []);
    await as(tx, manager);
    const [{ id: pipeline }] =
      await tx`insert into crm_pipelines (name) values ('  Тестовая  ') returning id, name`;
    const [{ id: st1 }] =
      await tx`insert into crm_stages (pipeline_id, name) values (${pipeline}, 'Новая') returning id`;
    const [{ id: st2 }] =
      await tx`insert into crm_stages (pipeline_id, name) values (${pipeline}, 'В работе') returning id`;
    const stages = await tx`select id, kind from crm_stages where pipeline_id = ${pipeline}`;
    const won = stages.find((s) => s.kind === "won")!.id as string;
    const lost = stages.find((s) => s.kind === "lost")!.id as string;
    await asServer(tx);
    return { s1, s2, manager, admin1, admin2, noCrm, pipeline, st1, st2, won, lost };
  }

  test("воронка: имя чистится, закрывающие этапы заводятся сами и не удаляются", () =>
    scenario(async (tx) => {
      const { manager, pipeline, st1, won } = await setup(tx);
      await as(tx, manager);
      const [p] = await tx`select name from crm_pipelines where id = ${pipeline}`;
      expect(p.name).toBe("Тестовая");
      const kinds = await tx`select kind from crm_stages where pipeline_id = ${pipeline} order by sort_order`;
      expect(kinds.map((k) => k.kind)).toEqual(["open", "open", "won", "lost"]);
      expect(await failure(tx, () => tx`delete from crm_stages where id = ${won}`)).toContain(
        "удалить нельзя",
      );
      expect(
        await failure(tx, () => tx`update crm_stages set kind = 'won' where id = ${st1}`),
      ).toContain("изменить нельзя");
      // Воронка без сделок удаляется вместе с этапами.
      await tx`delete from crm_pipelines where id = ${pipeline}`;
      const left = await tx`select 1 from crm_stages where pipeline_id = ${pipeline}`;
      expect(left.length).toBe(0);
    }));

  test("права: справочники правит только настройка, без права CRM не видно ничего", () =>
    scenario(async (tx) => {
      const { admin1, noCrm, pipeline } = await setup(tx);
      await as(tx, admin1);
      expect((await tx`select 1 from crm_pipelines where id = ${pipeline}`).length).toBe(1);
      expect(
        await failure(tx, () => tx`insert into crm_pipelines (name) values ('Чужая')`),
      ).toContain("row-level security");
      const upd = await tx`update crm_pipelines set name = 'x' where id = ${pipeline} returning id`;
      expect(upd.length).toBe(0);
      expect(
        await failure(tx, () => tx`select crm_pipelines_reorder(${tx.array([pipeline], "uuid")})`),
      ).toContain("crm_forbidden");

      await as(tx, noCrm);
      expect((await tx`select 1 from crm_pipelines`).length).toBe(0);
      expect((await tx`select 1 from crm_deals`).length).toBe(0);
      expect((await tx`select * from crm_people()`).length).toBe(0);
    }));

  test("сделки: свой клуб и без клуба — видно, чужой клуб — нет; настройка видит все", () =>
    scenario(async (tx) => {
      const { s1, s2, manager, admin1, admin2, pipeline, st1 } = await setup(tx);
      await as(tx, admin1);
      const [{ id: own }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id)
        values ('Своя', ${pipeline}, ${st1}, ${s1}) returning id`;
      const [{ id: free }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id) values ('Без клуба', ${pipeline}, ${st1}) returning id`;
      expect(
        await failure(
          tx,
          () => tx`insert into crm_deals (title, pipeline_id, stage_id, studio_id)
                   values ('Чужая', ${pipeline}, ${st1}, ${s2})`,
        ),
      ).toContain("row-level security");

      await as(tx, admin2);
      const seen = await tx`select id from crm_deals order by title`;
      expect(seen.map((d) => d.id)).toEqual([free]);
      // Лента и задачи чужой сделки тоже закрыты.
      expect((await tx`select 1 from crm_deal_events where deal_id = ${own}`).length).toBe(0);
      expect(
        await failure(tx, () => tx`insert into crm_deal_events (deal_id, body) values (${own}, 'x')`),
      ).toContain("row-level security");
      // Удалить сделку может только настройка.
      expect((await tx`delete from crm_deals where id = ${free} returning id`).length).toBe(0);

      await as(tx, manager);
      expect((await tx`select 1 from crm_deals`).length).toBe(2);
      expect((await tx`delete from crm_deals where id = ${free} returning id`).length).toBe(1);
    }));

  test("этап: вход, закрытие, причина отказа и события ленты", () =>
    scenario(async (tx) => {
      const { s1, admin1, manager, pipeline, st1, st2, won, lost } = await setup(tx);
      await as(tx, admin1);
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, tags)
        values (' Анна ', ${pipeline}, ${st1}, ${s1}, ${tx.array(["vip", " vip ", "", "акция"], "text")})
        returning id, title, tags, closed_at`.then((r) => {
        expect(r[0].title).toBe("Анна");
        expect(r[0].tags).toEqual(["vip", "акция"]);
        expect(r[0].closed_at).toBeNull();
        return r;
      });
      const [reason] = await tx`select id, name from crm_loss_reasons limit 1`;

      await tx`update crm_deals set stage_id = ${st2}, responsible_id = ${manager} where id = ${deal}`;
      await tx`update crm_deals set stage_id = ${lost}, loss_reason_id = ${reason.id} where id = ${deal}`;
      let [d] = await tx`select closed_at, loss_reason_id from crm_deals where id = ${deal}`;
      expect(d.closed_at).not.toBeNull();
      expect(d.loss_reason_id).toBe(reason.id);

      // Вернули в работу — снова открыта, причина снята.
      await tx`update crm_deals set stage_id = ${won} where id = ${deal}`;
      await tx`update crm_deals set stage_id = ${st1} where id = ${deal}`;
      [d] = await tx`select closed_at, loss_reason_id from crm_deals where id = ${deal}`;
      expect(d.closed_at).toBeNull();
      expect(d.loss_reason_id).toBeNull();

      const events =
        await tx`select kind, meta, author_name from crm_deal_events where deal_id = ${deal} order by created_at, kind`;
      expect(events.map((e) => e.kind).sort()).toEqual(
        ["created", "responsible", "stage", "stage", "stage", "stage"].sort(),
      );
      const toLost = events.find((e) => e.kind === "stage" && e.meta.to_kind === "lost")!;
      expect(toLost.meta.from).toBe("В работе");
      expect(toLost.meta.reason).toBe(reason.name);
      expect(toLost.author_name).toBe("Анна Админ");
      expect(events.find((e) => e.kind === "responsible")!.meta.to).toBe("Марина Менеджер");
    }));

  test("этап другой воронки не встаёт: сделка попадает в первый этап своей", () =>
    scenario(async (tx) => {
      const { manager, pipeline, st1 } = await setup(tx);
      await as(tx, manager);
      const [{ id: p2 }] = await tx`insert into crm_pipelines (name) values ('Вторая') returning id`;
      const [{ id: first }] =
        await tx`insert into crm_stages (pipeline_id, name) values (${p2}, 'Старт') returning id`;
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id) values ('Д', ${pipeline}, ${st1}) returning id`;
      await tx`update crm_deals set pipeline_id = ${p2} where id = ${deal}`;
      const [d] = await tx`select stage_id from crm_deals where id = ${deal}`;
      expect(d.stage_id).toBe(first);
      const [e] = await tx`select meta from crm_deal_events where deal_id = ${deal} and kind = 'pipeline'`;
      expect(e.meta.to).toBe("Вторая");
    }));

  test("комментарии: автор — база, событие не подделать, правит и удаляет только автор", () =>
    scenario(async (tx) => {
      const { s1, admin1, manager, pipeline, st1 } = await setup(tx);
      await as(tx, admin1);
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id) values ('Д', ${pipeline}, ${st1}, ${s1}) returning id`;
      const [note] = await tx`
        insert into crm_deal_events (deal_id, kind, body, author_name, meta)
        values (${deal}, 'stage', '  Перезвонить  ', 'Подделка', '{"to":"x"}')
        returning id, kind, body, author_id, author_name, meta`;
      expect(note.kind).toBe("note");
      expect(note.body).toBe("Перезвонить");
      expect(note.author_id).toBe(admin1);
      expect(note.author_name).toBe("Анна Админ");
      expect(note.meta).toEqual({});
      expect(
        await failure(tx, () => tx`insert into crm_deal_events (deal_id, body) values (${deal}, '  ')`),
      ).toContain("Комментарий пуст");

      await as(tx, manager);
      expect(
        (await tx`update crm_deal_events set body = 'чужое' where id = ${note.id} returning id`).length,
      ).toBe(0);
      expect((await tx`delete from crm_deal_events where id = ${note.id} returning id`).length).toBe(0);

      await as(tx, admin1);
      const [edited] =
        await tx`update crm_deal_events set body = 'Перезвонить в 15:00' where id = ${note.id} returning edited_at, author_name`;
      expect(edited.edited_at).not.toBeNull();
      // Событие «создана» автор сделки не правит и не удаляет.
      expect(
        (await tx`delete from crm_deal_events where deal_id = ${deal} and kind = 'created' returning id`)
          .length,
      ).toBe(0);
      expect((await tx`delete from crm_deal_events where id = ${note.id} returning id`).length).toBe(1);
    }));

  test("задачи: исполнитель по умолчанию — ответственный, выполнение — в ленту", () =>
    scenario(async (tx) => {
      const { s1, admin1, manager, pipeline, st1 } = await setup(tx);
      await as(tx, admin1);
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
        values ('Д', ${pipeline}, ${st1}, ${s1}, ${manager}) returning id`;
      const [task] = await tx`
        insert into crm_tasks (deal_id, title, due_at, auto) values (${deal}, ' Позвонить ', now() + interval '1 day', true)
        returning id, title, assignee_id, auto, created_by`;
      expect(task.title).toBe("Позвонить");
      expect(task.assignee_id).toBe(manager);
      expect(task.auto).toBe(false);
      expect(task.created_by).toBe(admin1);

      const [done] =
        await tx`update crm_tasks set done_at = '2000-01-01' where id = ${task.id} returning done_at, done_by`;
      expect(done.done_by).toBe(admin1);
      expect(new Date(done.done_at).getFullYear()).toBeGreaterThan(2020);
      const [e] = await tx`select body from crm_deal_events where deal_id = ${deal} and kind = 'task_done'`;
      expect(e.body).toBe("Позвонить");

      const [undone] = await tx`update crm_tasks set done_at = null where id = ${task.id} returning done_by`;
      expect(undone.done_by).toBeNull();
    }));

  test("удаление этапа: со сделками — только с переносом; порядок этапов", () =>
    scenario(async (tx) => {
      const { manager, admin1, pipeline, st1, st2, won } = await setup(tx);
      await as(tx, manager);
      await tx`insert into crm_deals (title, pipeline_id, stage_id) values ('Д1', ${pipeline}, ${st1}), ('Д2', ${pipeline}, ${st1})`;
      expect(await failure(tx, () => tx`select crm_stage_delete(${st1})`)).toContain(
        "выберите этап",
      );
      await as(tx, admin1);
      expect(await failure(tx, () => tx`select crm_stage_delete(${st1}, ${st2})`)).toContain(
        "crm_forbidden",
      );
      await as(tx, manager);
      const [{ crm_stage_delete: moved }] = await tx`select crm_stage_delete(${st1}, ${st2})`;
      expect(moved).toBe(2);
      expect((await tx`select 1 from crm_deals where stage_id = ${st2}`).length).toBe(2);
      expect((await tx`select 1 from crm_stages where id = ${st1}`).length).toBe(0);

      // Порядок: закрывающий этап в порядке обычных не участвует.
      const [{ id: st3 }] =
        await tx`insert into crm_stages (pipeline_id, name) values (${pipeline}, 'Третий') returning id`;
      await tx`select crm_stages_reorder(${pipeline}, ${tx.array([won, st3, st2], "uuid")})`;
      const order = await tx`
        select id from crm_stages where pipeline_id = ${pipeline} order by (kind <> 'open'), sort_order`;
      expect(order.slice(0, 2).map((s) => s.id)).toEqual([st3, st2]);
      // Воронку со сделками удалить нельзя.
      expect(await failure(tx, () => tx`delete from crm_pipelines where id = ${pipeline}`)).toContain(
        "crm_deals_pipeline_id_fkey",
      );
    }));

  test("контакт: привязывается к карточке клиента по телефону, если совпала одна", () =>
    scenario(async (tx) => {
      const { s1, admin1 } = await setup(tx);
      const [{ id: client }] = await tx`
        insert into clients (studio_id, first_name, last_name, phone)
        values (${s1}, 'Анна', 'Иванова', '+995555123456') returning id`;
      await as(tx, admin1);
      const [linked] = await tx`
        insert into crm_contacts (name, phone, email) values (' Анна ', '555 12 34 56', ' A@Example.com ')
        returning name, email, client_id, created_by`;
      expect(linked.name).toBe("Анна");
      expect(linked.email).toBe("a@example.com");
      expect(linked.client_id).toBe(client);
      expect(linked.created_by).toBe(admin1);
      const [none] = await tx`insert into crm_contacts (name, phone) values ('Кто-то', '+995599000000') returning client_id`;
      expect(none.client_id).toBeNull();
    }));

  test("вне модели прав: владелец клуба видит CRM, администратор — нет; crm_people", () =>
    scenario(async (tx) => {
      const { s1, manager, pipeline } = await setup(tx);
      const owner = await staff(tx, s1, "owner", "Владелец", null);
      const legacyAdmin = await staff(tx, s1, "admin", "Старый админ", null);
      await as(tx, owner);
      expect((await tx`select 1 from crm_pipelines where id = ${pipeline}`).length).toBe(1);
      const people = await tx`select id from crm_people()`;
      const ids = people.map((p) => p.id);
      expect(ids).toContain(owner);
      expect(ids).toContain(manager);
      expect(ids).not.toContain(legacyAdmin);
      await as(tx, legacyAdmin);
      expect((await tx`select 1 from crm_pipelines`).length).toBe(0);
    }));
});
