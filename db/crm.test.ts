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
      expect((await tx`select title from crm_tasks where deal_id = ${m.deal_id!} order by created_at`).map((t) => t.title)).toEqual(["Связаться с клиентом", "Клиент молчит"]);

      // Клиент ответил до срока — задание пропускается.
      await tx`insert into crm_messages (conversation_id, direction, body, status, created_at)
               values (${m.conversation_id}, 'out', 'Ещё раз', 'sent', now() - interval '1 hour')`;
      await ingest(tx, bot, "9", { external_id: "9", name: "Нино Б." }, { external_id: "2", body: "Приду" });
      await tx`update crm_automation_jobs set run_at = now() - interval '1 minute' where status = 'pending'`;
      await run(tx);
      expect((await tx`select 1 from crm_tasks where deal_id = ${m.deal_id!} and title = 'Клиент молчит'`).length).toBe(1);
      const [job] = await tx`select result from crm_automation_jobs where event_key like 'out:%' and status = 'skipped'`;
      expect(job.result).toBe("Клиент ответил");
    }));
  // Связь с порталом (2026-11-17_zzzzzz_crm_portal_events.sql) -----------------

  test("портал: покупка закрывает сделку, пробное и запись запускают правила этапа", () =>
    scenario(async (tx) => {
      const { s1, manager, pipeline, st1, st2, won } = await setup(tx);
      await as(tx, manager);
      await rule(tx, st1, "trial_sale", "move", { stage_id: st2 });
      await rule(tx, st2, "booked", "tag", { tag: "записан" });
      await asServer(tx);
      const [{ id: client }] = await tx`
        insert into clients (studio_id, first_name, last_name, phone)
        values (${s1}, 'Анна', 'Иванова', '+995555123456') returning id`;
      const [{ id: contact }] = await tx`
        insert into crm_contacts (name, phone) values ('Анна', '+995555123456') returning id, client_id`.then((r) => {
        expect(r[0].client_id).toBe(client);
        return r;
      });
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, contact_id, budget)
        values ('Анна', ${pipeline}, ${st1}, ${s1}, ${contact}, 50) returning id`;
      const membership = async (kind: string, name: string) =>
        (
          await tx`insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
                   values (${s1}, ${name}, ${kind}, ${kind === "trial" ? 1 : 8}, 30, 100) returning id`
        )[0].id as string;
      const sell = async (m: string, amount: number) =>
        tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
           values (${s1}, ${client}, ${m}, ${amount}, current_date, 'new')`;

      // Пробное — сделка не закрыта, сработало правило этапа.
      await sell(await membership("trial", "Пробное"), 20);
      await run(tx);
      let [d] = await tx`select stage_id, closed_at, sale_id from crm_deals where id = ${deal}`;
      expect(d).toMatchObject({ stage_id: st2, closed_at: null, sale_id: null });

      // Запись на занятие — правило «записан».
      const [{ id: workout }] = await tx`insert into workouts (studio_id, name) values (${s1}, 'Растяжка') returning id`;
      const [{ id: entry }] = await tx`
        insert into schedule_entries (studio_id, workout_id, kind, capacity, starts_at, ends_at)
        values (${s1}, ${workout}, 'group', 10, now() + interval '1 day', now() + interval '25 hours') returning id`;
      await tx`insert into schedule_bookings (studio_id, entry_id, client_id, status) values (${s1}, ${entry}, ${client}, 'booked')`;
      await run(tx);
      [d] = await tx`select tags from crm_deals where id = ${deal}`;
      expect(d.tags).toEqual(["записан"]);

      // Абонемент — сделка «Успешно», бюджет — сумма продажи.
      await sell(await membership("package", "Пакет 8"), 320);
      [d] = await tx`select stage_id, closed_at, sale_id, budget from crm_deals where id = ${deal}`;
      expect(d.stage_id).toBe(won);
      expect(d.closed_at).not.toBeNull();
      expect(d.sale_id).not.toBeNull();
      expect(Number(d.budget)).toBe(320);
      const notes = await tx`select body from crm_deal_events where deal_id = ${deal} and kind = 'auto'`;
      expect(notes.map((n) => n.body)).toContain("Куплен абонемент «Пакет 8» — сделка закрыта");
    }));
  test("объединение контактов: личности, диалоги и сделки переходят; чужой клуб — нельзя", () =>
    scenario(async (tx) => {
      const { s1, s2, admin1, admin2, pipeline } = await setup(tx);
      const bot1 = await account(tx, "telegram_bot", s1, pipeline);
      const ig = await account(tx, "instagram", s1, pipeline);
      const bot2 = await account(tx, "telegram_bot", s2, pipeline);
      const a = await ingest(tx, bot1, "1", { external_id: "1", name: "Анна", phone: "+995555000001" }, { external_id: "1", body: "tg" });
      const b = await ingest(tx, ig, "ig", { external_id: "ig", username: "anna.i", name: "Anna" }, { external_id: "1", body: "ig" });
      const c = await ingest(tx, bot2, "3", { external_id: "3", name: "Чужая" }, { external_id: "1", body: "x" });

      await as(tx, admin1);
      const found = await tx`select id, channels, deals from crm_contact_search('@anna', ${a.contact_id})`;
      expect(found.map((f) => f.id)).toEqual([b.contact_id]);
      expect(found[0]).toMatchObject({ channels: ["instagram"], deals: 1 });
      expect(await failure(tx, () => tx`select crm_contacts_merge(${a.contact_id}, ${a.contact_id})`)).toContain("один и тот же");
      expect(await failure(tx, () => tx`select crm_contacts_merge(${a.contact_id}, ${c.contact_id})`)).toContain("другого клуба");
      await tx`select crm_contacts_merge(${b.contact_id}, ${a.contact_id})`;

      await asServer(tx);
      expect((await tx`select 1 from crm_contacts where id = ${a.contact_id}`).length).toBe(0);
      const [kept] = await tx`select phone from crm_contacts where id = ${b.contact_id}`;
      expect(kept.phone).toBe("+995555000001");
      expect((await tx`select 1 from crm_contact_identities where contact_id = ${b.contact_id}`).length).toBe(2);
      expect((await tx`select 1 from crm_conversations where contact_id = ${b.contact_id}`).length).toBe(2);
      expect((await tx`select 1 from crm_deals where contact_id = ${b.contact_id}`).length).toBe(2);
      // Следующее сообщение из Telegram приходит уже объединённому контакту.
      const again = await ingest(tx, bot1, "1", { external_id: "1", name: "Анна" }, { external_id: "2", body: "ещё" });
      expect(again.contact_id).toBe(b.contact_id);

      await as(tx, admin2);
      expect((await tx`select * from crm_contact_search('чуж')`).length).toBe(1);
    }));
  test("отчёт: этапы, закрытые за период, причины, ответственные, скорость ответа — по видимым сделкам", () =>
    scenario(async (tx) => {
      const { s1, s2, admin1, admin2, manager, pipeline, st1, st2, won, lost } = await setup(tx);
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      const m = await ingest(tx, bot, "1", { external_id: "1", name: "А" }, { external_id: "1", body: "Привет", sent_at: new Date(Date.now() - 30 * 60_000).toISOString() });
      await tx`insert into crm_messages (conversation_id, direction, body, status) values (${m.conversation_id}, 'out', 'Да', 'sent')`;
      const [reason] = await tx`select id, name from crm_loss_reasons order by sort_order limit 1`;
      await tx`insert into crm_deals (title, pipeline_id, stage_id, studio_id, budget, responsible_id, source) values
        ('w', ${pipeline}, ${won}, ${s1}, 300, ${admin1}, 'Instagram'),
        ('l', ${pipeline}, ${st1}, ${s1}, 100, ${admin1}, 'Instagram'),
        ('o', ${pipeline}, ${st2}, ${s1}, 50, null, null),
        ('чужая', ${pipeline}, ${won}, ${s2}, 999, ${admin2}, 'Сайт')`;
      await tx`update crm_deals set stage_id = ${lost}, loss_reason_id = ${reason.id} where title = 'l'`;

      await as(tx, admin1);
      const [{ r }] = await tx`select crm_report(${pipeline}, current_date - 1, current_date) as r`;
      expect(r.created).toBe(4); // три свои и сделка из входящего; чужого клуба не видно
      expect(r.won).toEqual({ count: 1, budget: 300 });
      expect(r.lost).toEqual({ count: 1, budget: 100 });
      expect(r.loss).toEqual([{ name: reason.name, count: 1 }]);
      const stages = Object.fromEntries(r.stages.map((x: { stage_id: string; count: number }) => [x.stage_id, x.count]));
      expect(stages).toEqual({ [st1]: 1, [st2]: 1 });
      const mine = r.people.find((p: { user_id: string }) => p.user_id === admin1);
      expect(mine).toMatchObject({ won: 1, won_budget: 300, lost: 1, open: 0 });
      expect(r.sources.find((x: { source: string }) => x.source === "Instagram")).toMatchObject({ created: 2, won: 1 });
      expect(r.reply.count).toBe(1);
      expect(Number(r.reply.median_minutes)).toBeGreaterThanOrEqual(29);
      expect(r.unanswered).toBe(0);

      await as(tx, manager);
      const [{ r: all }] = await tx`select crm_report(${pipeline}, current_date - 1, current_date) as r`;
      expect(all.won).toEqual({ count: 2, budget: 1299 });
    }));
  // Задачи (2026-11-18_crm_tasks.sql) ------------------------------------------

  test("задачи: тип, комментарий, результат в ленте; закрытие сделки и смена ответственного", () =>
    scenario(async (tx) => {
      const { s1, admin1, admin2, manager, pipeline, st1, won } = await setup(tx);
      const [type] = await tx`select id, name from crm_task_types order by sort_order limit 1`;
      await as(tx, admin1);
      expect(await failure(tx, () => tx`insert into crm_task_types (name) values ('Свой')`)).toContain("row-level security");
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
        values ('Д', ${pipeline}, ${st1}, ${s1}, ${admin1}) returning id`;
      const [t1] = await tx`
        insert into crm_tasks (deal_id, title, due_at, assignee_id, type_id, note, result)
        values (${deal}, 'Позвонить', now() + interval '1 hour', ${manager}, ${type.id}, '  после 18:00 ', 'рано')
        returning id, note, result, assignee_id`;
      expect(t1).toMatchObject({ note: "после 18:00", result: null, assignee_id: manager });
      const [t2] = await tx`
        insert into crm_tasks (deal_id, title, due_at) values (${deal}, 'Написать', now() - interval '1 hour') returning id, assignee_id`;
      expect(t2.assignee_id).toBe(admin1);

      // Список: просроченная — первой; фильтр по исполнителю и типу.
      // Задача по умолчанию новой сделки здесь не нужна.
      await tx`delete from crm_tasks where deal_id = ${deal} and auto`;
      const list = await tx`select id, deal_title, stage_name from crm_tasks_list()`;
      expect(list.map((t) => t.id)).toEqual([t2.id, t1.id]);
      expect(list[0]).toMatchObject({ deal_title: "Д", stage_name: "Новая" });
      expect((await tx`select id from crm_tasks_list(${manager})`).map((t) => t.id)).toEqual([t1.id]);
      expect((await tx`select id from crm_tasks_list(null, ${type.id})`).map((t) => t.id)).toEqual([t1.id]);

      // Перенос и выполнение с результатом.
      await tx`update crm_tasks set due_at = now() + interval '2 days', assignee_id = ${admin1} where id = ${t1.id}`;
      await tx`update crm_tasks set done_at = now(), result = ' Договорились на пробное ' where id = ${t1.id}`;
      const [ev] = await tx`select body, meta from crm_deal_events where deal_id = ${deal} and kind = 'task_done'`;
      expect(ev.body).toBe("Позвонить");
      expect(ev.meta).toEqual({ type: type.name, result: "Договорились на пробное" });
      expect((await tx`select id from crm_tasks_list(null, null, true)`).map((t) => t.id)).toEqual([t1.id]);

      // Смена ответственного — его невыполненные задачи уходят новому.
      await tx`update crm_deals set responsible_id = ${manager} where id = ${deal}`;
      expect((await tx`select assignee_id from crm_tasks where id = ${t2.id}`)[0].assignee_id).toBe(manager);

      // Закрытие сделки закрывает задачи без событий в ленте.
      await tx`update crm_deals set stage_id = ${won} where id = ${deal}`;
      const [closed] = await tx`select done_at, result from crm_tasks where id = ${t2.id}`;
      expect(closed.done_at).not.toBeNull();
      expect(closed.result).toBe("Сделка закрыта");
      expect((await tx`select 1 from crm_deal_events where deal_id = ${deal} and kind = 'task_done'`).length).toBe(1);

      // Чужой клуб задач не видит.
      await as(tx, admin2);
      expect((await tx`select 1 from crm_tasks_list(null, null, true)`).length).toBe(0);
    }));

  test("автозадача: исполнитель — выбранный сотрудник, тип — из правила", () =>
    scenario(async (tx) => {
      const { s1, manager, admin1, admin2, pipeline, st1, st2 } = await setup(tx);
      const [type] = await tx`select id from crm_task_types order by sort_order limit 1`;
      await as(tx, manager);
      await rule(tx, st1, "enter", "task", { title: "Связаться", due_minutes: 15, assignee: admin2, type_id: type.id });
      await rule(tx, st2, "enter", "task", { title: "Дожать", due_minutes: 0, type_id: crypto.randomUUID() });
      expect(
        await failure(tx, () => rule(tx, st1, "enter", "task", { title: "x", assignee: crypto.randomUUID() })),
      ).toContain("Исполнитель задачи не найден");
      await asServer(tx);
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
        values ('Д', ${pipeline}, ${st1}, ${s1}, ${admin1}) returning id`;
      await run(tx);
      const [a] = await tx`select assignee_id, type_id, auto from crm_tasks where deal_id = ${deal}`;
      expect(a).toMatchObject({ assignee_id: admin2, type_id: type.id, auto: true });
      await tx`update crm_deals set stage_id = ${st2} where id = ${deal}`;
      await run(tx);
      const [b] = await tx`select assignee_id, type_id from crm_tasks where deal_id = ${deal} and title = 'Дожать'`;
      expect(b).toMatchObject({ assignee_id: admin1, type_id: null });
    }));

  // Шаблоны WhatsApp и «написать первым» (2026-11-18_zz_crm_wa_templates.sql) -----

  test("написать первым: диалог по карточке клиента, по телефону или новый; шаблоны пишет только сервер", () =>
    scenario(async (tx) => {
      const { s1, admin1 } = await setup(tx);
      const wa = await account(tx, "whatsapp", s1);
      const [{ id: client }] = await tx`
        insert into clients (studio_id, first_name, last_name, phone)
        values (${s1}, 'Анна', 'Иванова', '+995555123456') returning id`;
      const start = async (chat: string, name: string, phone: string, clientId: string | null) =>
        (await tx`select crm_conversation_start(${wa}, ${chat}, ${name}, ${phone}, ${clientId}) as r`)[0].r as {
          conversation_id: string;
          contact_id: string;
        };

      // Нового контакта заводит и привязывает к клиенту; сделки не создаёт.
      const a = await start("995555123456", "Анна Иванова", "+995555123456", client);
      const [contact] = await tx`select name, client_id from crm_contacts where id = ${a.contact_id}`;
      expect(contact).toMatchObject({ name: "Анна Иванова", client_id: client });
      expect((await tx`select 1 from crm_deals where contact_id = ${a.contact_id}`).length).toBe(0);
      // Повтор — тот же диалог.
      expect((await start("995555123456", "Анна", "+995555123456", client)).conversation_id).toBe(a.conversation_id);
      // Клиент ответил — тот же контакт и диалог, сделка появилась.
      const reply = await ingest(tx, wa, "995555123456", { external_id: "995555123456", name: "Anna", phone: "+995555123456" }, { external_id: "w1", body: "Да" });
      expect(reply.conversation_id).toBe(a.conversation_id);
      expect(reply.contact_id).toBe(a.contact_id);
      expect(reply.deal_id).toBeTruthy();
      // Контакт с тем же телефоном без клиента — находится по номеру.
      const [{ id: other }] = await tx`insert into crm_contacts (name, phone) values ('Нино', '+995 599 00 00 01') returning id`;
      expect((await start("995599000001", "Нино", "+995599000001", null)).contact_id).toBe(other);

      await tx`insert into crm_wa_templates (account_id, name, language, category, body, vars, status)
               values (${wa}, 'trial_invite', 'ru', 'UTILITY', 'Здравствуйте, {{1}}! Ждём вас.', '{name}', 'APPROVED')`;
      await as(tx, admin1);
      expect((await tx`select status from crm_wa_templates`).map((t) => t.status)).toEqual(["APPROVED"]);
      for (const run of [
        () => tx`insert into crm_wa_templates (account_id, name, language, category, body) values (${wa}, 'x_y_z', 'ru', 'UTILITY', 'текст')`,
        () => tx`update crm_wa_templates set status = 'APPROVED'`,
        () => tx`select crm_conversation_start(${wa}, '1', 'x', '+1', null)`,
      ])
        expect(await failure(tx, run)).toMatch(/permission denied|row-level security/);
    }));

  // Задача у каждой сделки и распределение (2026-11-18_zzz_crm_tasks_required_distribution.sql)

  test("у открытой сделки всегда есть задача: новая, из сообщения, возвращённая из закрытых", () =>
    scenario(async (tx) => {
      const { s1, admin1, manager, pipeline, st1, st2, won } = await setup(tx);
      await as(tx, admin1);
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
        values ('Д', ${pipeline}, ${st1}, ${s1}, ${admin1}) returning id`;
      const open = () => tx`select title, assignee_id, auto from crm_tasks where deal_id = ${deal} and done_at is null`;
      expect(await open()).toEqual([{ title: "Связаться с клиентом", assignee_id: admin1, auto: true }]);
      // Переход между открытыми этапами второй задачи не ставит.
      await tx`update crm_deals set stage_id = ${st2} where id = ${deal}`;
      expect((await open()).length).toBe(1);
      // Закрыли — задачи закрыты; вернули в работу — снова есть задача.
      await tx`update crm_deals set stage_id = ${won} where id = ${deal}`;
      expect((await open()).length).toBe(0);
      await tx`update crm_deals set stage_id = ${st1} where id = ${deal}`;
      expect((await open()).length).toBe(1);
      // Сразу закрытая сделка задачи не получает.
      const [{ id: closed }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id) values ('З', ${pipeline}, ${won}, ${s1}) returning id`;
      expect((await tx`select 1 from crm_tasks where deal_id = ${closed}`).length).toBe(0);
      // У этапа своё правило «вошла → задача» — задачу поставит оно.
      await as(tx, manager);
      await tx`insert into crm_automations (stage_id, trigger, action, params)
               values (${st2}, 'enter', 'task', ${JSON.stringify({ title: "Позвонить", due_minutes: 30 })}::text::jsonb)`;
      const [{ id: ruled }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id) values ('П', ${pipeline}, ${st2}, ${s1}) returning id`;
      expect((await tx`select 1 from crm_tasks where deal_id = ${ruled}`).length).toBe(0);
      // Входящее сообщение: новая сделка — с задачей.
      await asServer(tx);
      const tg = await account(tx, "telegram_bot", s1, pipeline);
      const m = await ingest(tx, tg, "900", { external_id: "900", name: "Анна" }, { external_id: "1", body: "Привет" });
      expect((await tx`select title from crm_tasks where deal_id = ${m.deal_id!}`).map((t) => t.title)).toEqual(["Связаться с клиентом"]);
    }));

  test("распределение новых заявок: по очереди между клубами и ответственными, случайно, выключено", () =>
    scenario(async (tx) => {
      const { s1, s2, admin1, admin2, manager, pipeline } = await setup(tx);
      // Настройку правит только crm.manage.
      await as(tx, admin1);
      await tx`update crm_distribution set mode = 'order'`;
      expect((await tx`select mode from crm_distribution`)[0].mode).toBe("off");
      expect(await failure(tx, () => tx`insert into crm_distribution_studios (studio_id) values (${s1})`)).toContain("row-level security");
      expect(await failure(tx, () => tx`select * from crm_distribution_next()`)).toContain("permission denied");
      await as(tx, manager);
      await tx`update crm_distribution set mode = 'order'`;
      await tx`insert into crm_distribution_studios (studio_id, user_ids, sort_order)
               values (${s1}, ${`{${admin1},${manager}}`}::uuid[], 1), (${s2}, ${`{${admin2}}`}::uuid[], 2)`;
      await asServer(tx);
      // Аккаунт клуба s1; новые люди делятся по очереди: s1, s2, s1, s2.
      const tg = await account(tx, "telegram_bot", s1, pipeline);
      const write = (n: number) =>
        ingest(tx, tg, `c${n}`, { external_id: `c${n}`, name: `Клиент ${n}` }, { external_id: `m${n}`, body: "Здравствуйте" });
      const got: [string, string | null][] = [];
      for (const n of [1, 2, 3, 4]) {
        const r = await write(n);
        const [d] = await tx`select studio_id, responsible_id from crm_deals where id = ${r.deal_id!}`;
        const [c] = await tx`select studio_id from crm_conversations where id = ${r.conversation_id}`;
        // Диалог — в клубе сделки: его сотрудники видят переписку.
        expect(c.studio_id).toBe(d.studio_id);
        got.push([d.studio_id, d.responsible_id]);
      }
      expect(got).toEqual([[s1, admin1], [s2, admin2], [s1, manager], [s2, admin2]]);
      // Задача новой сделки — на её ответственного.
      expect((await tx`select count(*)::int as n from crm_tasks where assignee_id = ${admin2} and done_at is null`)[0].n).toBe(2);
      // Тот же человек пишет снова после закрытия сделки — уже не «впервые»: клуб аккаунта.
      const [{ contact_id: firstContact }] = await tx`select contact_id from crm_conversations where external_chat_id = 'c1'`;
      await tx`update crm_deals set stage_id = (select id from crm_stages where pipeline_id = ${pipeline} and kind = 'lost')
               where contact_id = ${firstContact}`;
      const again = await ingest(tx, tg, "c1", { external_id: "c1", name: "Клиент 1" }, { external_id: "m1b", body: "Я снова" });
      expect((await tx`select studio_id, responsible_id from crm_deals where id = ${again.deal_id!}`)[0]).toEqual({ studio_id: s1, responsible_id: null });
      // Случайно — только клубы и люди из настройки.
      await tx`update crm_distribution set mode = 'random'`;
      for (const n of [10, 11, 12, 13, 14, 15]) {
        const r = await write(n);
        const [d] = await tx`select studio_id, responsible_id from crm_deals where id = ${r.deal_id!}`;
        expect([s1, s2]).toContain(d.studio_id);
        expect(d.studio_id === s1 ? [admin1, manager] : [admin2]).toContain(d.responsible_id);
      }
      // Выключено — клуб аккаунта, без ответственного.
      await tx`update crm_distribution set mode = 'off'`;
      const off = await write(20);
      expect((await tx`select studio_id, responsible_id from crm_deals where id = ${off.deal_id!}`)[0]).toEqual({ studio_id: s1, responsible_id: null });
    }));
  // Скорость ответа и уведомления (2026-11-19_crm_reply_sla_notifications.sql) ---

  test("ожидание ответа: начинается с входящего, кончается ответом сотрудника; автоответ не в счёт", () =>
    scenario(async (tx) => {
      const { s1, pipeline } = await setup(tx);
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      const m = await ingest(tx, bot, "w1", { external_id: "w1", name: "Анна" }, { external_id: "1", body: "Привет", sent_at: "2026-11-20T07:00:00Z" });
      await ingest(tx, bot, "w1", { external_id: "w1", name: "Анна" }, { external_id: "2", body: "Вы тут?", sent_at: "2026-11-20T07:05:00Z" });
      const waiting = async () =>
        (await tx`select waiting_since from crm_conversations where id = ${m.conversation_id}`)[0].waiting_since as Date | null;
      expect((await waiting())!.toISOString()).toBe("2026-11-20T07:00:00.000Z");
      await tx`insert into crm_messages (conversation_id, direction, body, status, auto, created_at)
               values (${m.conversation_id}, 'out', 'Скоро ответим', 'sent', true, '2026-11-20T07:06:00Z')`;
      expect(await waiting()).not.toBeNull();
      await tx`insert into crm_messages (conversation_id, direction, body, status, created_at)
               values (${m.conversation_id}, 'out', 'Не ушло', 'failed', '2026-11-20T07:07:00Z')`;
      expect(await waiting()).not.toBeNull();
      await tx`insert into crm_messages (conversation_id, direction, body, status, created_at)
               values (${m.conversation_id}, 'out', 'Здравствуйте', 'sent', '2026-11-20T07:08:00Z')`;
      expect(await waiting()).toBeNull();
      // Рабочие часы: ночное сообщение «ждёт» с открытия (9:00 по Тбилиси).
      const [w] = await tx`select crm_work_start('2026-11-20T20:30:00Z') as night, crm_work_start('2026-11-20T08:00:00Z') as day`;
      expect((w.night as Date).toISOString()).toBe("2026-11-21T05:00:00.000Z");
      expect((w.day as Date).toISOString()).toBe("2026-11-20T08:00:00.000Z");
    }));

  test("уведомления: срок задачи, клиент ждёт, эскалация руководителю, назначение сделки — только подписанным", () =>
    scenario(async (tx) => {
      const { s1, manager, admin1, noCrm, pipeline, st1 } = await setup(tx);
      const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
      // Подписка — только с правом CRM; норматив правит настройка.
      await as(tx, noCrm);
      expect(await failure(tx, () => tx`select crm_push_subscribe(${endpoint("x")}, 'k', 'a')`)).toContain("crm_forbidden");
      await as(tx, admin1);
      expect(await failure(tx, () => tx`select crm_push_subscribe('https://evil.example/x', 'k', 'a')`)).toContain("bad_endpoint");
      await tx`select crm_push_subscribe(${endpoint("admin1")}, 'k', 'a', 'Chrome')`;
      await tx`update crm_settings set reply_sla_minutes = 1`;
      expect((await tx`select reply_sla_minutes from crm_settings`)[0].reply_sla_minutes).toBe(15);
      expect(await failure(tx, () => tx`select crm_notifications_collect()`)).toContain("permission denied");
      await as(tx, manager);
      await tx`select crm_push_subscribe(${endpoint("manager")}, 'k', 'a')`;
      await tx`update crm_settings set reply_sla_minutes = 10, escalate_minutes = 30`;
      // Сделку назначили другому — ему уведомление; себе — нет.
      const [{ id: deal }] = await tx`
        insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
        values ('Анна', ${pipeline}, ${st1}, ${s1}, ${admin1}) returning id`;
      await tx`insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
               values ('Своя', ${pipeline}, ${st1}, ${s1}, ${manager})`;
      await asServer(tx);
      let rows = await tx`select user_id, kind, title from crm_notifications order by created_at`;
      expect(rows.map((r) => [r.user_id, r.kind, r.title])).toEqual([[admin1, "deal_assigned", "Новая сделка: Анна"]]);

      // Клиент пишет в 11:00 по Тбилиси; в 11:05 — рано, в 11:15 — ответственному, в 11:40 — руководителю.
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      const [{ id: contact }] = await tx`insert into crm_contacts (name) values ('Анна') returning id`;
      await tx`update crm_deals set contact_id = ${contact} where id = ${deal}`;
      const [{ id: conv }] = await tx`
        insert into crm_conversations (contact_id, account_id, external_chat_id) values (${contact}, ${bot}, 'n1') returning id`;
      await tx`insert into crm_messages (conversation_id, direction, body, status, created_at)
               values (${conv}, 'in', 'Сколько стоит?', 'received', '2026-11-20T07:00:00Z')`;
      await tx`update crm_tasks set due_at = '2026-11-20T07:10:00Z' where deal_id = ${deal}`;
      const collect = async (at: string) => (await tx`select crm_notifications_collect(${at}::timestamptz) as n`)[0].n as number;
      expect(await collect("2026-11-20T07:05:00Z")).toBe(0);
      expect(await collect("2026-11-20T07:15:00Z")).toBe(2);
      expect(await collect("2026-11-20T07:16:00Z")).toBe(0);
      expect(await collect("2026-11-20T07:40:00Z")).toBe(1);
      rows = await tx`select user_id, kind, title, url from crm_notifications where kind <> 'deal_assigned' order by kind`;
      expect(rows.map((r) => [r.user_id, r.kind])).toEqual([
        [manager, "reply_escalation"],
        [admin1, "reply_wait"],
        [admin1, "task_due"],
      ]);
      expect(rows[1].title).toBe("Клиент ждёт ответа: Анна");
      expect(rows[1].url).toBe(`/crm/inbox?c=${conv}`);
      // Ночью (23:00 по Тбилиси) про ожидание не напоминаем; перенесённая задача напомнит заново.
      await tx`delete from crm_notifications where kind in ('reply_wait', 'reply_escalation')`;
      await tx`update crm_tasks set due_at = '2026-11-20T18:50:00Z' where deal_id = ${deal}`;
      expect(await collect("2026-11-20T19:00:00Z")).toBe(1);

      // Отправка: пачка с браузерами получателя, второй раз не отдаётся.
      const [{ r: claimed }] = await tx`select crm_notifications_claim(50) as r`;
      const list = claimed as { kind: string; targets: { endpoint: string }[] }[];
      expect(list.length).toBe(3);
      expect(list.find((n) => n.kind === "reply_wait")).toBeUndefined();
      expect(list.find((n) => n.kind === "task_due")!.targets.map((t) => t.endpoint)).toEqual([endpoint("admin1")]);
      expect(((await tx`select crm_notifications_claim(50) as r`)[0].r as unknown[]).length).toBe(0);
      await tx`select crm_push_gone(${tx.array([endpoint("admin1")], "text")})`;
      expect((await tx`select 1 from crm_staff_push_subscriptions`).length).toBe(1);
      // Без подписки уведомления не копятся.
      await tx`update crm_tasks set due_at = '2026-11-20T18:55:00Z' where deal_id = ${deal}`;
      expect(await collect("2026-11-20T19:01:00Z")).toBe(0);
    }));

  test("отчёт по сотрудникам: сделки, ответы в норматив, задачи", () =>
    scenario(async (tx) => {
      const { s1, manager, admin1, pipeline, st1, won } = await setup(tx);
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      const m = await ingest(tx, bot, "r1", { external_id: "r1", name: "Анна" }, { external_id: "1", body: "Привет", sent_at: "2026-11-20T07:00:00Z" });
      await tx`update crm_deals set responsible_id = ${admin1}, budget = 300 where id = ${m.deal_id!}`;
      const say = (dir: string, at: string, by: string | null = null) =>
        tx`insert into crm_messages (conversation_id, direction, body, status, sent_by, created_at)
           values (${m.conversation_id}, ${dir}, 'x', ${dir === "in" ? "received" : "sent"}, ${by}, ${at}::timestamptz)`;
      await say("out", "2026-11-20T07:05:00Z", admin1); // 5 минут — в норматив
      await say("in", "2026-11-20T08:00:00Z");
      await say("in", "2026-11-20T08:10:00Z");
      await say("out", "2026-11-20T09:00:00Z", manager); // 60 минут — мимо
      await tx`update crm_deals set stage_id = ${won} where id = ${m.deal_id!}`;
      await tx`insert into crm_deals (title, pipeline_id, stage_id, studio_id, responsible_id)
               values ('В работе', ${pipeline}, ${st1}, ${s1}, ${admin1})`;
      await tx`update crm_tasks set due_at = now() - interval '1 day' where done_at is null`;
      await as(tx, manager);
      const [{ r }] = await tx`select crm_people_report('2026-01-01', '2030-01-01', ${pipeline}) as r`;
      const rep = r as { sla_minutes: number; asked: number; answered: number; reply_in_sla: number; people: Record<string, unknown>[] };
      expect(rep).toMatchObject({ sla_minutes: 15, asked: 2, answered: 2, reply_in_sla: 1 });
      const a = rep.people.find((p) => p.user_id === admin1)!;
      expect(a).toMatchObject({ open: 1, won: 1, won_budget: 300, replies: 1, reply_median: 5, reply_in_sla: 1, messages: 1, tasks_overdue: 1 });
      // Задача закрытой сделки закрылась сама — в «выполнено» не идёт.
      expect(a.tasks_done).toBe(0);
      expect(rep.people.find((p) => p.user_id === manager)).toMatchObject({ replies: 1, reply_median: 60, reply_in_sla: 0 });
    }));

  // Сценарии по клиентам клуба (2026-11-19_zz_crm_scenarios.sql) -------------------

  async function portalClient(tx: Tx, studioId: string, name: string, phone: string) {
    const [{ id }] = await tx`
      insert into clients (studio_id, first_name, last_name, phone) values (${studioId}, ${name}, 'Тестова', ${phone}) returning id`;
    return id as string;
  }
  async function product(tx: Tx, studioId: string, kind: string, name: string) {
    const [{ id }] = await tx`
      insert into memberships (studio_id, name, kind, visits_count, duration_days, price)
      values (${studioId}, ${name}, ${kind}, ${kind === "trial" ? 1 : 8}, 30, 100) returning id`;
    return id as string;
  }
  const scenarioDeals = (tx: Tx, client: string) =>
    tx`select d.id, d.scenario, d.source, d.studio_id, d.responsible_id, d.closed_at, d.budget, s.kind, s.name as stage
         from crm_deals d join crm_contacts c on c.id = d.contact_id join crm_stages s on s.id = d.stage_id
        where c.client_id = ${client} order by d.created_at`;

  test("сценарии: продление — сделка по заканчивающемуся абонементу, без повторов; покупка закрывает", () =>
    scenario(async (tx) => {
      const { s1, manager, admin1 } = await setup(tx);
      const client = await portalClient(tx, s1, "Анна", "+995555000001");
      const pack = await product(tx, s1, "package", "Пакет 8");
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${client}, ${pack}, 320, current_date, 'new')`;
      // Включает только настройка; включить без этапа нельзя.
      await as(tx, admin1);
      await tx`update crm_scenarios set enabled = true where key = 'expiring'`;
      expect((await tx`select enabled from crm_scenarios where key = 'expiring'`)[0].enabled).toBe(false);
      expect(await failure(tx, () => tx`select crm_scenario_preview('expiring')`)).toContain("crm_forbidden");
      await as(tx, manager);
      expect(await failure(tx, () => tx`update crm_scenarios set enabled = true, stage_id = null where key = 'lapsed'`)).toContain("выберите воронку и этап");
      await tx`update crm_scenarios set enabled = true, params = '{"days": 5, "left": 1}'::jsonb where key = 'expiring'`;
      await tx`insert into crm_distribution_studios (studio_id, user_ids) values (${s1}, ${`{${admin1}}`}::uuid[])`;
      expect((await tx`select crm_scenario_preview('expiring') as n`)[0].n).toBe(0);
      await asServer(tx);
      expect((await tx`select crm_scenarios_run() as n`)[0].n).toBe(0);
      // Срок кончается через 3 дня.
      await tx`update client_memberships set started_at = current_date - 27, ends_at = current_date + 3,
                      starts_on_first_visit = false where client_id = ${client}`;
      await as(tx, manager);
      expect((await tx`select crm_scenario_preview('expiring') as n`)[0].n).toBe(1);
      expect((await tx`select crm_scenario_preview('expiring', '{"days": 1, "left": 0}'::jsonb) as n`)[0].n).toBe(0);
      await asServer(tx);
      expect((await tx`select crm_scenarios_run() as n`)[0].n).toBe(1);
      expect((await tx`select crm_scenarios_run() as n`)[0].n).toBe(0);
      let deals = await scenarioDeals(tx, client);
      expect(deals.length).toBe(1);
      expect(deals[0]).toMatchObject({ scenario: "expiring", source: "Продление", studio_id: s1, responsible_id: admin1, stage: "Заканчивается абонемент" });
      const [task] = await tx`select title, note, assignee_id from crm_tasks where deal_id = ${deals[0].id}`;
      expect(task.title).toBe("Предложить продление");
      expect(task.note).toContain("Абонемент «Пакет 8» до ");
      expect(task.assignee_id).toBe(admin1);
      // Сотрудник сценарий сделке не ставит.
      await as(tx, manager);
      await tx`update crm_deals set scenario = 'lapsed' where id = ${deals[0].id}`;
      await asServer(tx);
      expect((await scenarioDeals(tx, client))[0].scenario).toBe("expiring");
      // Продление куплено — сделка «Успешно» с суммой; новой по ждущему продлению нет.
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${client}, ${pack}, 300, current_date, 'renewal')`;
      deals = await scenarioDeals(tx, client);
      expect(deals[0].kind).toBe("won");
      expect(Number(deals[0].budget)).toBe(300);
      await tx`delete from crm_scenario_log`;
      expect((await tx`select crm_scenarios_run() as n`)[0].n).toBe(0);
      const [{ r }] = await tx`select crm_scenarios_report(current_date - 1, current_date + 1) as r`;
      expect(r).toEqual([{ key: "expiring", created: 1, open: 0, won: 1, lost: 0, won_budget: 300 }]);
    }));

  test("сценарии: долг закрывается платежом, «давно не был» — посещением, пробное без покупки", () =>
    scenario(async (tx) => {
      const { s1, manager } = await setup(tx);
      await as(tx, manager);
      await tx`update crm_scenarios set enabled = true where key in ('overdue_payment', 'inactive', 'trial_no_purchase')`;
      await asServer(tx);
      const pack = await product(tx, s1, "package", "Пакет 8");
      const trial = await product(tx, s1, "trial", "Пробное");
      const [{ id: workout }] = await tx`insert into workouts (studio_id, name) values (${s1}, 'Растяжка') returning id`;
      const visit = async (client: string, daysAgo: number) => {
        const [{ id: entry }] = await tx`
          insert into schedule_entries (studio_id, workout_id, kind, capacity, starts_at, ends_at)
          values (${s1}, ${workout}, 'group', 10, now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}) + interval '1 hour') returning id`;
        const [{ id }] = await tx`
          insert into schedule_bookings (studio_id, entry_id, client_id, status) values (${s1}, ${entry}, ${client}, 'booked') returning id`;
        await tx`update schedule_bookings set status = 'attended' where id = ${id}`;
      };

      // Должник: платёж просрочен на 3 дня.
      const debtor = await portalClient(tx, s1, "Нино", "+995555000002");
      const [{ id: sale }] = await tx`
        insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
        values (${s1}, ${debtor}, ${pack}, 320, current_date - 20, 'new') returning id`;
      const [{ id: inst }] = await tx`
        insert into sale_installments (sale_id, due_date, amount) values (${sale}, current_date - 3, 160) returning id`;
      await visit(debtor, 1);
      // Купил и не ходит 20 дней.
      const sleeper = await portalClient(tx, s1, "Мари", "+995555000003");
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${sleeper}, ${pack}, 320, current_date - 30, 'new')`;
      await tx`update client_memberships set created_at = now() - interval '30 days' where client_id = ${sleeper}`;
      await visit(sleeper, 20);
      // Был на пробном 2 дня назад и не купил.
      const guest = await portalClient(tx, s1, "Тамар", "+995555000004");
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${guest}, ${trial}, 20, current_date - 3, 'trial')`;
      await visit(guest, 2);

      expect((await tx`select crm_scenarios_run() as n`)[0].n).toBe(3);
      expect((await scenarioDeals(tx, debtor)).map((d) => d.scenario)).toEqual(["overdue_payment"]);
      expect((await scenarioDeals(tx, sleeper)).map((d) => d.scenario)).toEqual(["inactive"]);
      expect((await scenarioDeals(tx, guest)).map((d) => d.scenario)).toEqual(["trial_no_purchase"]);

      // Платёж внесён — сделка о долге закрыта; покупка её не закрывает.
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${debtor}, ${pack}, 300, current_date, 'renewal')`;
      expect((await scenarioDeals(tx, debtor))[0].closed_at).toBeNull();
      await tx`update sale_installments set paid = true where id = ${inst}`;
      const [paid] = await scenarioDeals(tx, debtor);
      expect(paid.kind).toBe("won");
      expect(Number(paid.budget)).toBe(160);
      // Пришёл на занятие — «давно не был» закрыта.
      await visit(sleeper, 0);
      expect((await scenarioDeals(tx, sleeper))[0].kind).toBe("won");
      // Гость купил абонемент — сделка после пробного «Успешно».
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${guest}, ${pack}, 320, current_date, 'new')`;
      expect((await scenarioDeals(tx, guest))[0].kind).toBe("won");
    }));

  // Источники и сквозная воронка (2026-11-19_zzz_crm_sources_funnel.sql) -----------

  test("форма сайта: заявка — контакт и сделка с метками; повтор ложится в ту же сделку", () =>
    scenario(async (tx) => {
      const { s1, manager, admin1, pipeline } = await setup(tx);
      await as(tx, admin1);
      expect(await failure(tx, () => tx`insert into crm_lead_forms (name) values ('Чужая')`)).toContain("row-level security");
      await as(tx, manager);
      const [form] = await tx`
        insert into crm_lead_forms (name, source, pipeline_id, studio_id) values (' Лендинг ', 'Сайт', ${pipeline}, ${s1})
        returning id, name, token`;
      expect(form.name).toBe("Лендинг");
      expect(await failure(tx, () => tx`select crm_lead_submit(${form.token}, '{}'::jsonb)`)).toContain("permission denied");
      await as(tx, admin1);
      expect((await tx`select 1 from crm_lead_forms`).length).toBe(0);
      await asServer(tx);
      const submit = async (data: Record<string, string>) =>
        (await tx`select crm_lead_submit(${form.token}, ${JSON.stringify(data)}::text::jsonb) as r`)[0].r as { deal_id: string; contact_id: string; created: boolean };
      expect(await failure(tx, () => submit({ name: "Без контактов" }))).toContain("crm_lead_empty");
      expect(await failure(tx, () => tx`select crm_lead_submit('nope', '{"phone": "+995555000010"}'::jsonb)`)).toContain("crm_form_not_found");
      const first = await submit({ name: "Анна", phone: "+995 555 000 010", message: "Хочу на пробное", utm_source: "instagram", utm_campaign: "Ноябрь", page: "https://site.example/promo" });
      expect(first.created).toBe(true);
      const [d] = await tx`select title, source, studio_id, utm_source, utm_campaign, page_url, lead_form_id from crm_deals where id = ${first.deal_id}`;
      expect(d).toEqual({ title: "Анна", source: "Сайт", studio_id: s1, utm_source: "instagram", utm_campaign: "Ноябрь", page_url: "https://site.example/promo", lead_form_id: form.id });
      expect((await tx`select count(*)::int as n from crm_tasks where deal_id = ${first.deal_id} and done_at is null`)[0].n).toBe(1);
      // Та же женщина оставила заявку ещё раз (номер записан иначе).
      const again = await submit({ name: "Анна", phone: "555000010", message: "Перезвоните" });
      expect(again).toMatchObject({ deal_id: first.deal_id, contact_id: first.contact_id, created: false });
      const notes = await tx`select body from crm_deal_events where deal_id = ${first.deal_id} and kind = 'auto' order by created_at`;
      expect(notes.map((n) => n.body)).toEqual([
        "Заявка с формы «Лендинг»\nХочу на пробное\nСтраница: https://site.example/promo",
        "Заявка с формы «Лендинг»\nПерезвоните",
      ]);
      expect((await tx`select leads_count from crm_lead_forms where id = ${form.id}`)[0].leads_count).toBe(2);
    }));

  test("ссылка с меткой: переходы считаются, код в первом сообщении — источник сделки", () =>
    scenario(async (tx) => {
      const { s1, manager, pipeline } = await setup(tx);
      await as(tx, manager);
      const [link] = await tx`
        insert into crm_links (name, source, campaign, target_kind, target, text)
        values ('Листовка', 'Листовки', 'Ваке, ноябрь', 'whatsapp', '+995555111222', 'Хочу записаться') returning id, code`;
      expect(link.code).toMatch(/^[a-z0-9]{6}$/);
      expect(await failure(tx, () => tx`insert into crm_links (name, source, target_kind, target) values ('x', 'y', 'url', 'http://a.b')`)).toContain("crm_links_url_check");
      await tx`update crm_links set clicks = 100 where id = ${link.id}`;
      expect(await failure(tx, () => tx`select crm_link_click(${link.code})`)).toContain("permission denied");
      await asServer(tx);
      const [{ r }] = await tx`select crm_link_click(${link.code.toUpperCase()}) as r`;
      expect(r).toMatchObject({ target_kind: "whatsapp", target: "+995555111222", text: "Хочу записаться" });
      expect((await tx`select clicks from crm_links where id = ${link.id}`)[0].clicks).toBe(1);
      expect((await tx`select crm_link_click('zzzzzz') as r`)[0].r).toBeNull();
      const wa = await account(tx, "whatsapp", s1, pipeline);
      const tg = await account(tx, "telegram_bot", s1, pipeline);
      const a = await ingest(tx, wa, "l1", { external_id: "995555000020", name: "Анна" }, { external_id: "1", body: `Хочу записаться #${link.code}` });
      const b = await ingest(tx, tg, "l2", { external_id: "77", name: "Нино" }, { external_id: "1", body: `/start ${link.code}` });
      const c = await ingest(tx, tg, "l3", { external_id: "78", name: "Мари" }, { external_id: "1", body: "Привет" });
      const deals = await tx`select id, source, utm_campaign, link_id from crm_deals where id in ${tx([a.deal_id!, b.deal_id!, c.deal_id!])}`;
      const byId = new Map(deals.map((d) => [d.id, d]));
      expect(byId.get(a.deal_id!)).toMatchObject({ source: "Листовки", utm_campaign: "Ваке, ноябрь", link_id: link.id });
      expect(byId.get(b.deal_id!)).toMatchObject({ source: "Листовки", link_id: link.id });
      expect(byId.get(c.deal_id!)).toMatchObject({ source: "Telegram", link_id: null });
    }));

  test("сквозная воронка: ответили → записаны → пришли → пробное → купили, выручка и расход по источнику", () =>
    scenario(async (tx) => {
      const { s1, s2, manager, admin2, pipeline, st1, lost } = await setup(tx);
      const pack = await product(tx, s1, "package", "Пакет 8");
      const trial = await product(tx, s1, "trial", "Пробное");
      const client = await portalClient(tx, s1, "Анна", "+995555000030");
      const bot = await account(tx, "telegram_bot", s1, pipeline);
      const [{ id: contact }] = await tx`insert into crm_contacts (name, phone) values ('Анна', '+995555000030') returning id`;
      const [{ id: conv }] = await tx`
        insert into crm_conversations (contact_id, account_id, external_chat_id) values (${contact}, ${bot}, 'f1') returning id`;
      const deal = async (title: string, source: string | null, studioId: string, contactId: string | null = null) =>
        (await tx`insert into crm_deals (title, pipeline_id, stage_id, studio_id, source, contact_id)
                  values (${title}, ${pipeline}, ${st1}, ${studioId}, ${source}, ${contactId}) returning id`)[0].id as string;
      const main = await deal("Анна", "Instagram", s1, contact);
      const cold = await deal("Холодная", "instagram", s1);
      await deal("Сайт", "Сайт", s2);
      await tx`update crm_deals set stage_id = ${lost} where id = ${cold}`;
      // Путь: ответ, пробное, запись, посещение, покупка, потом продление.
      await tx`insert into crm_messages (conversation_id, direction, body, status, auto) values (${conv}, 'out', 'авто', 'sent', true)`;
      expect((await tx`select first_reply_at from crm_deals where id = ${main}`)[0].first_reply_at).toBeNull();
      await tx`insert into crm_messages (conversation_id, direction, body, status) values (${conv}, 'out', 'Здравствуйте', 'sent')`;
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${client}, ${trial}, 20, current_date, 'trial')`;
      const [{ id: workout }] = await tx`insert into workouts (studio_id, name) values (${s1}, 'Растяжка') returning id`;
      const [{ id: entry }] = await tx`
        insert into schedule_entries (studio_id, workout_id, kind, capacity, starts_at, ends_at)
        values (${s1}, ${workout}, 'group', 10, now() + interval '1 hour', now() + interval '2 hours') returning id`;
      const [{ id: booking }] = await tx`
        insert into schedule_bookings (studio_id, entry_id, client_id, status) values (${s1}, ${entry}, ${client}, 'booked') returning id`;
      await tx`update schedule_bookings set status = 'attended' where id = ${booking}`;
      const [path] = await tx`select first_reply_at, booked_at, attended_at, trial_at from crm_deals where id = ${main}`;
      for (const step of ["first_reply_at", "booked_at", "attended_at", "trial_at"]) expect(path[step]).not.toBeNull();
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${client}, ${pack}, 320, current_date, 'new')`;
      await tx`insert into sales (studio_id, client_id, membership_id, total_amount, sold_at, sale_kind)
               values (${s1}, ${client}, ${pack}, 300, current_date, 'renewal')`;
      // Сотрудник путь не подделает.
      await as(tx, manager);
      await tx`update crm_deals set attended_at = now() where id = ${cold}`;
      expect((await tx`select attended_at from crm_deals where id = ${cold}`)[0].attended_at).toBeNull();
      // Расход: весь месяц — 310 при 31 дне; период в 10 дней этого месяца — 100.
      await tx`insert into crm_ad_spend (month, source, amount) values ('2026-01-01', 'instagram', 310)`;
      await tx`insert into crm_ad_spend (month, source, amount)
               values (date_trunc('month', current_date)::date, ' Instagram ', 600), (date_trunc('month', current_date)::date, 'Блогеры', 50)`;
      const [{ r: jan }] = await tx`select crm_funnel_report('2026-01-11', '2026-01-20', 'source') as r`;
      expect((jan as { total: { spend: number; leads: number } }).total).toMatchObject({ spend: 100, leads: 0 });
      const [{ r }] = await tx`
        select crm_funnel_report(date_trunc('month', current_date)::date,
                                 (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'source') as r`;
      const rep = r as { rows: Record<string, unknown>[]; total: Record<string, number> };
      expect(rep.rows.map((x) => x.label)).toEqual(["Instagram", "Сайт", "Блогеры"]);
      expect(rep.rows[0]).toMatchObject({ leads: 2, replied: 1, booked: 1, attended: 1, trial: 1, won: 1, lost: 1, revenue: 320, ltv: 640, spend: 600 });
      expect(rep.rows[2]).toMatchObject({ leads: 0, spend: 50 });
      expect(rep.total).toMatchObject({ leads: 3, won: 1, revenue: 320, spend: 650 });
      // По клубам; сотрудник другого клуба видит только свой.
      await as(tx, admin2);
      const [{ r: own }] = await tx`select crm_funnel_report(current_date - 1, current_date + 1, 'studio') as r`;
      expect((own as { rows: { label: string; leads: number }[] }).rows.map((x) => [x.label, x.leads])).toEqual([
        ["Сабуртало", 1],
        // Расход без клуба — общий, виден всем.
        ["Без клуба", 0],
      ]);
      expect(await failure(tx, () => tx`select crm_funnel_report(current_date, current_date, 'nope')`)).toContain("crm_bad_group");
    }));
});
