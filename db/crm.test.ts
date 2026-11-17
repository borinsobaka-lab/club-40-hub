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
  // Переписка (2026-11-17_zzzz_crm_messaging.sql) ------------------------------

  async function account(tx: Tx, kind: string, studioId: string | null, pipeline: string | null = null) {
    const [{ id }] = await tx`
      insert into crm_channel_accounts (kind, name, studio_id, pipeline_id, external_id)
      values (${kind}, ${kind}, ${studioId}, ${pipeline}, ${crypto.randomUUID()}) returning id`;
    await tx`insert into crm_channel_secrets (account_id, token, webhook_secret) values (${id}, 'tok', 'sec')`;
    return id as string;
  }

  async function ingest(
    tx: Tx,
    acc: string,
    chat: string,
    sender: Record<string, string | null>,
    message: Record<string, unknown>,
  ) {
    const [{ r }] = await tx`
      select crm_ingest_message(${acc}, ${chat}, ${JSON.stringify(sender)}::text::jsonb, ${JSON.stringify(message)}::text::jsonb) as r`;
    return r as {
      duplicate: boolean;
      conversation_id: string;
      message_id?: string;
      contact_id: string;
      deal_id?: string | null;
    };
  }

  test("входящее: контакт, диалог, сообщение и сделка; повтор не задваивает", () =>
    scenario(async (tx) => {
      const { s1, pipeline, st1 } = await setup(tx);
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      const sender = { external_id: "555", username: "anna", name: "Анна И." };
      const first = await ingest(tx, bot, "555", sender, { external_id: "1", body: "Привет" });
      expect(first.duplicate).toBe(false);
      const [deal] = await tx`select title, stage_id, studio_id, source, contact_id from crm_deals where id = ${first.deal_id!}`;
      expect(deal).toMatchObject({ title: "Анна И.", stage_id: st1, studio_id: s1, source: "Telegram" });
      expect(deal.contact_id).toBe(first.contact_id);

      const dup = await ingest(tx, bot, "555", sender, { external_id: "1", body: "Привет" });
      expect(dup.duplicate).toBe(true);
      const second = await ingest(tx, bot, "555", { ...sender, username: "anna_new" }, { external_id: "2", body: "Есть места?" });
      expect(second.contact_id).toBe(first.contact_id);
      expect(second.deal_id).toBe(first.deal_id);

      const [conv] = await tx`
        select unread_count, last_message_text, last_direction, studio_id from crm_conversations where id = ${first.conversation_id}`;
      expect(conv).toMatchObject({ unread_count: 2, last_message_text: "Есть места?", last_direction: "in", studio_id: s1 });
      expect((await tx`select 1 from crm_messages where conversation_id = ${first.conversation_id}`).length).toBe(2);
      expect((await tx`select 1 from crm_deals where contact_id = ${first.contact_id}`).length).toBe(1);
      const [ident] = await tx`select username from crm_contact_identities where contact_id = ${first.contact_id}`;
      expect(ident.username).toBe("anna_new");

      // Ответ сотрудника снимает непрочитанные; закрытая сделка — новое обращение.
      await tx`insert into crm_messages (conversation_id, direction, body, status) values (${first.conversation_id}, 'out', 'Да!', 'sent')`;
      const [after] = await tx`select unread_count, last_direction from crm_conversations where id = ${first.conversation_id}`;
      expect(after).toMatchObject({ unread_count: 0, last_direction: "out" });
      const won = (await tx`select id from crm_stages where pipeline_id = ${pipeline} and kind = 'won'`)[0].id;
      await tx`update crm_deals set stage_id = ${won} where id = ${first.deal_id!}`;
      const third = await ingest(tx, bot, "555", sender, { external_id: "3", body: "Хочу ещё" });
      expect(third.deal_id).not.toBe(first.deal_id);
    }));

  test("одна карточка: Telegram — общий id, Instagram — по нику, WhatsApp — по телефону", () =>
    scenario(async (tx) => {
      const { s1, s2 } = await setup(tx);
      const bot1 = await account(tx, "telegram_bot", s1);
      const bot2 = await account(tx, "telegram_bot", s2);
      const a = await ingest(tx, bot1, "7", { external_id: "7", name: "Нино" }, { external_id: "1", body: "a" });
      const b = await ingest(tx, bot2, "7", { external_id: "7", name: "Нино" }, { external_id: "1", body: "b" });
      expect(b.contact_id).toBe(a.contact_id);
      expect(b.conversation_id).not.toBe(a.conversation_id);
      expect((await tx`select 1 from crm_contact_identities where contact_id = ${a.contact_id}`).length).toBe(1);

      const ig1 = await account(tx, "instagram", s1);
      const ig2 = await account(tx, "instagram", s2);
      const i1 = await ingest(tx, ig1, "ig-1", { external_id: "ig-1", username: "Mari.K", name: "Мари" }, { external_id: "m1", body: "x" });
      const i2 = await ingest(tx, ig2, "ig-2", { external_id: "ig-2", username: "mari.k", name: "Мари" }, { external_id: "m1", body: "y" });
      expect(i2.contact_id).toBe(i1.contact_id);
      expect((await tx`select 1 from crm_contact_identities where contact_id = ${i1.contact_id}`).length).toBe(2);
      const other = await ingest(tx, ig2, "ig-3", { external_id: "ig-3", username: "other", name: "Мари" }, { external_id: "m1", body: "z" });
      expect(other.contact_id).not.toBe(i1.contact_id);

      await tx`update crm_contacts set phone = '+995555123456' where id = ${a.contact_id}`;
      const wa = await account(tx, "whatsapp", s1);
      const w = await ingest(tx, wa, "995555123456", { external_id: "995555123456", name: "Nino", phone: "+995 555 12 34 56" }, { external_id: "w1", body: "hi" });
      expect(w.contact_id).toBe(a.contact_id);
    }));

  test("диалоги: свой клуб и аккаунт без клуба — видно; писать и читать токены нельзя", () =>
    scenario(async (tx) => {
      const { s1, s2, admin1, admin2, manager } = await setup(tx);
      const bot1 = await account(tx, "telegram_bot", s1);
      const free = await account(tx, "telegram_bot", null);
      const m1 = await ingest(tx, bot1, "1", { external_id: "1", name: "А" }, { external_id: "1", body: "в Ваке" });
      const m2 = await ingest(tx, free, "2", { external_id: "2", name: "Б" }, { external_id: "1", body: "общий" });

      await as(tx, admin2);
      const seen = await tx`select id from crm_conversations`;
      expect(seen.map((c) => c.id)).toEqual([m2.conversation_id]);
      expect((await tx`select 1 from crm_messages where conversation_id = ${m1.conversation_id}`).length).toBe(0);
      await tx`select crm_conversation_read(${m1.conversation_id})`;

      await as(tx, admin1);
      expect((await tx`select 1 from crm_conversations`).length).toBe(2);
      expect((await tx`select 1 from crm_messages`).length).toBe(2);
      for (const run of [
        () => tx`insert into crm_messages (conversation_id, direction, body) values (${m1.conversation_id}, 'out', 'x')`,
        () => tx`update crm_messages set body = 'x' where conversation_id = ${m1.conversation_id}`,
        () => tx`select token from crm_channel_secrets`,
        () => tx`select crm_ingest_message(${bot1}, '1', '{"external_id":"1"}'::jsonb, '{"body":"x"}'::jsonb)`,
        () => tx`insert into crm_channel_accounts (kind, name) values ('telegram_bot', 'мой')`,
      ])
        expect(await failure(tx, run)).toMatch(/permission denied|row-level security/);
      await tx`select crm_conversation_read(${m1.conversation_id})`;

      await asServer(tx);
      const counts = await tx`select id, unread_count from crm_conversations order by created_at`;
      expect(counts.find((c) => c.id === m1.conversation_id)!.unread_count).toBe(0);
      // Клуб аккаунта сменили — диалог ушёл за ним.
      await as(tx, manager);
      await tx`update crm_channel_accounts set studio_id = ${s2} where id = ${bot1}`;
      await as(tx, admin1);
      expect((await tx`select id from crm_conversations`).map((c) => c.id)).toEqual([m2.conversation_id]);
    }));
  // Автоматизации (2026-11-17_zzzzz_crm_automations.sql) -----------------------

  async function rule(
    tx: Tx,
    stage: string,
    trigger: string,
    action: string,
    params: Record<string, unknown>,
    delay = 0,
  ) {
    const [{ id }] = await tx`
      insert into crm_automations (stage_id, trigger, delay_minutes, action, params)
      values (${stage}, ${trigger}, ${delay}, ${action}, ${JSON.stringify(params)}::text::jsonb) returning id`;
    return id as string;
  }
  const run = async (tx: Tx) =>
    (await tx`select crm_automations_run() as r`)[0].r as { job_id: string; conversation_id: string; body: string }[];

  test("автоматизации: вход в этап — очередь ответственных, задача, тег, перевод", () =>
    scenario(async (tx) => {
      const { s1, manager, admin1, admin2, noCrm, pipeline, st1, st2 } = await setup(tx);
      await as(tx, manager);
      await rule(tx, st1, "enter", "responsible", { user_ids: [admin1, noCrm, admin2] });
      await rule(tx, st1, "enter", "task", { title: "Связаться с {имя}", due_minutes: 30 });
      await rule(tx, st1, "enter", "tag", { tag: "#новый" });
      await rule(tx, st2, "enter", "move", { stage_id: st1 }, 60);
      for (const bad of [
        () => rule(tx, st1, "enter", "task", { title: " " }),
        () => rule(tx, st1, "enter", "responsible", { user_ids: [] }),
        () => rule(tx, st1, "enter", "move", { stage_id: st1 }),
        () => rule(tx, st1, "no_reply", "tag", { tag: "x" }, 0),
      ])
        expect(await failure(tx, bad)).not.toBeNull();
      await as(tx, admin1);
      expect(await failure(tx, () => rule(tx, st1, "enter", "tag", { tag: "x" }))).toContain("row-level security");

      await asServer(tx);
      const [{ id: contact }] = await tx`insert into crm_contacts (name) values ('Анна Иванова') returning id`;
      const ids: string[] = [];
      for (const title of ["1", "2", "3"]) {
        const [{ id }] = await tx`
          insert into crm_deals (title, pipeline_id, stage_id, studio_id, contact_id)
          values (${title}, ${pipeline}, ${st1}, ${s1}, ${contact}) returning id`;
        ids.push(id as string);
      }
      // Сделка с ответственным — очередь её пропускает.
      const [{ id: manual }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, responsible_id) values ('ручная', ${pipeline}, ${st1}, ${manager}) returning id`;
      expect(await run(tx)).toEqual([]);

      const deals = await tx`select id, responsible_id, tags from crm_deals where id = any(${tx.array([...ids, manual], "uuid")}) order by title`;
      // noCrm без права CRM в очереди не участвует: admin1, admin2, admin1.
      expect(deals.slice(0, 3).map((d) => d.responsible_id)).toEqual([admin1, admin2, admin1]);
      expect(deals[3].responsible_id).toBe(manager);
      expect(deals[0].tags).toEqual(["новый"]);
      const [task] = await tx`select title, auto, assignee_id from crm_tasks where deal_id = ${ids[0]}`;
      expect(task).toMatchObject({ title: "Связаться с Анна", auto: true, assignee_id: admin1 });
      const notes = await tx`select body from crm_deal_events where deal_id = ${ids[0]} and kind = 'auto'`;
      expect(notes[0].body).toBe("Поставлена задача: Связаться с Анна");

      // Перевод с задержкой: не раньше срока; ушла из этапа — пропуск.
      await tx`update crm_deals set stage_id = ${st2} where id = any(${tx.array(ids.slice(0, 2), "uuid")})`;
      await run(tx);
      expect((await tx`select 1 from crm_deals where stage_id = ${st2}`).length).toBe(2);
      const won = (await tx`select id from crm_stages where pipeline_id = ${pipeline} and kind = 'won'`)[0].id;
      await tx`update crm_deals set stage_id = ${won} where id = ${ids[1]}`;
      await tx`update crm_automation_jobs set run_at = now() - interval '1 minute' where status = 'pending'`;
      await run(tx);
      const [back] = await tx`select stage_id from crm_deals where id = ${ids[0]}`;
      expect(back.stage_id).toBe(st1);
      const [skipped] = await tx`select status, result from crm_automation_jobs where deal_id = ${ids[1]} and status = 'skipped'`;
      expect(skipped.result).toBe("Сделка уже в другом этапе");
      // Вернулась в первый этап — его правила сработают заново (новый вход).
      await run(tx);
      expect((await tx`select 1 from crm_tasks where deal_id = ${ids[0]}`).length).toBe(2);
    }));

  test("автоматизации: сообщение клиенту, входящее и «не ответил»", () =>
    scenario(async (tx) => {
      const { s1, manager, pipeline, st1, st2 } = await setup(tx);
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      await as(tx, manager);
      await rule(tx, st1, "enter", "message", { body: "Здравствуйте, {имя} ! Это {клуб}." });
      await rule(tx, st1, "inbound", "move", { stage_id: st2 });
      await rule(tx, st2, "no_reply", "task", { title: "Клиент молчит", due_minutes: 0 }, 120);
      await asServer(tx);

      const m = await ingest(tx, bot, "9", { external_id: "9", name: "Нино Б." }, { external_id: "1", body: "Привет" });
      // Первое сообщение заводит сделку (правила входа); «клиент написал» —
      // для следующих сообщений.
      expect((await tx`select stage_id from crm_deals where id = ${m.deal_id!}`)[0].stage_id).toBe(st1);
      const out = await run(tx);
      expect(out.length).toBe(1);
      await ingest(tx, bot, "9", { external_id: "9", name: "Нино Б." }, { external_id: "1b", body: "Вы тут?" });
      await run(tx);
      expect(out[0]).toMatchObject({ conversation_id: m.conversation_id, body: "Здравствуйте, Нино! Это Ваке." });
      // Входящее перевело сделку во второй этап.
      expect((await tx`select stage_id from crm_deals where id = ${m.deal_id!}`)[0].stage_id).toBe(st2);
      await tx`select crm_automation_job_finish(${out[0].job_id}, true)`;
      expect((await tx`select status from crm_automation_jobs where id = ${out[0].job_id}`)[0].status).toBe("done");
      expect(
        (await tx`select body from crm_deal_events where deal_id = ${m.deal_id!} and kind = 'auto'`).map((e) => e.body),
      ).toContain("Отправлено сообщение клиенту");

      // Автосообщение «не ответил» не заводит; ответ сотрудника — заводит.
      await tx`insert into crm_messages (conversation_id, direction, body, status, auto) values (${m.conversation_id}, 'out', 'авто', 'sent', true)`;
      expect((await tx`select 1 from crm_automation_jobs where event_key like 'out:%'`).length).toBe(0);
      await tx`insert into crm_messages (conversation_id, direction, body, status)
               values (${m.conversation_id}, 'out', 'Ждём вас', 'sent')`;
      await tx`update crm_automation_jobs set run_at = now() - interval '1 minute' where status = 'pending'`;
      await run(tx);
      expect((await tx`select title from crm_tasks where deal_id = ${m.deal_id!}`).map((t) => t.title)).toEqual(["Клиент молчит"]);

      // Клиент ответил до срока — задание пропускается.
      await tx`insert into crm_messages (conversation_id, direction, body, status, created_at)
               values (${m.conversation_id}, 'out', 'Ещё раз', 'sent', now() - interval '1 hour')`;
      await ingest(tx, bot, "9", { external_id: "9", name: "Нино Б." }, { external_id: "2", body: "Приду" });
      await tx`update crm_automation_jobs set run_at = now() - interval '1 minute' where status = 'pending'`;
      await run(tx);
      expect((await tx`select 1 from crm_tasks where deal_id = ${m.deal_id!}`).length).toBe(1);
      const [job] = await tx`select result from crm_automation_jobs where event_key like 'out:%' and status = 'skipped'`;
      expect(job.result).toBe("Клиент ответил");
    }));
});
