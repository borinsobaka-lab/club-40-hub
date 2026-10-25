/**
 * Тесты базы знаний (db/migrations/2026-10-24_knowledge_base.sql): кто что
 * видит (владелец — всё, сотрудник — выданные базы, читатель — только
 * опубликованное), дерево (путь, перенос, порядок, копия), черновики и
 * публикация, поиск, отметка чтения и отчёт, файлы бакета kb-media.
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

type Row = Record<string, unknown>;

const doc = (text: string) => [
  { id: "a", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] },
];

describe.skipIf(!url)("база знаний (база)", () => {
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

  async function user(tx: Tx, email = `u-${crypto.randomUUID()}@example.com`): Promise<string> {
    await tx`set local session_replication_role = replica`;
    const [{ id }] = await tx`insert into auth.users (email) values (${email}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  async function studio(tx: Tx): Promise<string> {
    const [{ id }] = await tx`insert into studios (name, format) values ('Тест', 'packages') returning id`;
    return id as string;
  }

  async function staff(tx: Tx, studioId: string, role = "admin"): Promise<string> {
    const id = await user(tx);
    await tx`insert into user_roles (user_id, studio_id, role) values (${id}, ${studioId}, ${role}::app_role)`;
    await tx`insert into profiles (id, studio_id, full_name) values (${id}, ${studioId}, ${"Сотрудник " + id.slice(0, 4)})
             on conflict (id) do update set full_name = excluded.full_name`;
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

  async function base(tx: Tx, title = "Стандарты"): Promise<string> {
    const [{ id }] = await tx`insert into kb_bases (title, rail_title) values (${title}, 'БЗ') returning id`;
    return id as string;
  }

  async function grant(tx: Tx, baseId: string, userId: string, level: "view" | "edit") {
    await tx`insert into kb_grants (base_id, subject_id, level) values (${baseId}, ${userId}, ${level})`;
  }

  async function node(
    tx: Tx,
    baseId: string,
    opts: { parent?: string | null; kind?: "folder" | "article"; title?: string; status?: string; text?: string } = {},
  ): Promise<string> {
    const [{ id }] = await tx`
      insert into kb_nodes (base_id, parent_id, kind, title, status, content)
      values (${baseId}, ${opts.parent ?? null}, ${opts.kind ?? "article"}, ${opts.title ?? "Статья"},
              ${opts.status ?? "published"}, ${opts.text ? JSON.stringify(doc(opts.text)) : null}::text::jsonb)
      returning id`;
    return id as string;
  }

  /** Владелец, читатель, редактор, сотрудник без доступа и база с деревом. */
  async function setup(tx: Tx) {
    const s = await studio(tx);
    const owner = await staff(tx, s, "owner");
    const reader = await staff(tx, s);
    const editor = await staff(tx, s, "trainer");
    const stranger = await staff(tx, s);
    const b = await base(tx);
    await grant(tx, b, reader, "view");
    await grant(tx, b, editor, "edit");
    const folder = await node(tx, b, { kind: "folder", title: "Администратор" });
    const pub = await node(tx, b, { parent: folder, title: "Открытие смены", text: "Администраторы открывают кассу" });
    const draft = await node(tx, b, { parent: folder, title: "Черновик", status: "draft" });
    return { s, owner, reader, editor, stranger, b, folder, pub, draft };
  }

  async function visible(tx: Tx, userId: string, baseId: string): Promise<string[]> {
    await as(tx, userId);
    const rows = await tx`select title from kb_nodes where base_id = ${baseId} order by title`;
    await asServer(tx);
    return (rows as Row[]).map((r) => r.title as string);
  }

  test("по умолчанию не видно ничего; владелец — всё; читатель — опубликованное", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      expect(await visible(tx, t.stranger, t.b)).toEqual([]);
      expect(await visible(tx, t.owner, t.b)).toEqual(["Администратор", "Открытие смены", "Черновик"]);
      expect(await visible(tx, t.editor, t.b)).toEqual(["Администратор", "Открытие смены", "Черновик"]);
      expect(await visible(tx, t.reader, t.b)).toEqual(["Администратор", "Открытие смены"]);

      await as(tx, t.stranger);
      expect(await tx`select id from kb_bases where id = ${t.b}`).toHaveLength(0);
      await as(tx, t.reader);
      expect(await tx`select id from kb_bases where id = ${t.b}`).toHaveLength(1);
      await asServer(tx);
    }));

  test("папка в черновике прячет опубликованное внутри; вернули — снова видно", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      const sub = await node(tx, t.b, { parent: t.folder, kind: "folder", title: "Вложенная" });
      await node(tx, t.b, { parent: sub, title: "Глубоко" });
      expect(await visible(tx, t.reader, t.b)).toContain("Глубоко");

      await tx`update kb_nodes set status = 'draft' where id = ${t.folder}`;
      expect(await visible(tx, t.reader, t.b)).toEqual([]);
      await tx`update kb_nodes set status = 'published' where id = ${t.folder}`;
      expect(await visible(tx, t.reader, t.b)).toEqual(["Администратор", "Вложенная", "Глубоко", "Открытие смены"]);
    }));

  test("доступ — только сотруднику; без роли сотрудника выданное не действует", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      const member = await user(tx);
      await grant(tx, t.b, member, "edit");
      expect(await visible(tx, member, t.b)).toEqual([]);
    }));

  test("читатель не пишет; редактор пишет; базы и доступы — только владелец", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      await as(tx, t.reader);
      expect(
        await failure(tx, () => tx`insert into kb_nodes (base_id, kind, title) values (${t.b}, 'article', 'x')`),
      ).toContain("row-level security");
      const upd = await tx`update kb_nodes set title = 'взлом' where id = ${t.pub} returning id`;
      expect(upd).toHaveLength(0);

      await as(tx, t.editor);
      const [{ id }] = await tx`insert into kb_nodes (base_id, kind, title) values (${t.b}, 'article', 'Новая') returning id`;
      const [n] = await tx`select created_by, status, sort_order from kb_nodes where id = ${id}`;
      expect(n.created_by).toBe(t.editor);
      expect(n.status).toBe("draft");
      expect(n.sort_order).toBe(2);
      expect(
        await failure(tx, () => tx`insert into kb_bases (title, rail_title) values ('Своя', 'С')`),
      ).toContain("row-level security");
      expect(
        await failure(tx, () => tx`insert into kb_grants (base_id, subject_id, level) values (${t.b}, ${t.stranger}, 'view')`),
      ).toContain("row-level security");
      expect(await tx`select id from kb_grants`).toHaveLength(1);

      await as(tx, t.owner);
      await tx`insert into kb_bases (title, rail_title) values ('Своя', 'С')`;
      expect(await tx`select id from kb_grants where base_id = ${t.b}`).toHaveLength(2);
      await asServer(tx);
    }));

  test("перенос: путь детей пересчитывается, внутрь себя нельзя, порядок по месту", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      const other = await node(tx, t.b, { kind: "folder", title: "Офис" });
      await as(tx, t.editor);
      await tx`select kb_move_node(${t.folder}, ${other}, 0)`;
      const [p] = await tx`select path from kb_nodes where id = ${t.pub}`;
      expect(p.path).toEqual([other, t.folder]);

      expect(await failure(tx, () => tx`select kb_move_node(${other}, ${t.folder}, 0)`)).toContain(
        "kb_move_into_self",
      );
      expect(await failure(tx, () => tx`select kb_move_node(${t.folder}, ${t.pub}, 0)`)).toContain(
        "kb_parent_not_folder",
      );

      await tx`select kb_move_node(${t.draft}, ${t.folder}, 0)`;
      const order = await tx`select title from kb_nodes where parent_id = ${t.folder} order by sort_order`;
      expect((order as Row[]).map((r) => r.title)).toEqual(["Черновик", "Открытие смены"]);

      await as(tx, t.reader);
      expect(await failure(tx, () => tx`select kb_move_node(${t.pub}, null, 0)`)).toContain("kb_forbidden");
      await asServer(tx);
    }));

  test("папку с содержимым не удалить; базу — вместе с деревом", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      await as(tx, t.editor);
      expect(await failure(tx, () => tx`delete from kb_nodes where id = ${t.folder}`)).toContain(
        "foreign key",
      );
      await tx`delete from kb_nodes where id = ${t.draft}`;
      await as(tx, t.owner);
      await tx`delete from kb_bases where id = ${t.b}`;
      await asServer(tx);
      expect(await tx`select id from kb_nodes where base_id = ${t.b}`).toHaveLength(0);
    }));

  test("черновик правок виден только редактору; публикация — текст, история, поиск", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      await as(tx, t.editor);
      const saved = await tx`select kb_save_draft(${t.pub}, ${JSON.stringify(doc("Новый регламент кассы"))}::text::jsonb, null) as at`;
      const at = saved[0].at as Date;
      expect(
        await failure(tx, () => tx`select kb_save_draft(${t.pub}, ${JSON.stringify(doc("Чужая правка"))}::text::jsonb, null)`),
      ).toContain("kb_draft_conflict");
      await tx`select kb_save_draft(${t.pub}, ${JSON.stringify(doc("Новый регламент кассы и сейфа"))}::text::jsonb, ${at})`;

      await as(tx, t.reader);
      expect(await tx`select node_id from kb_drafts`).toHaveLength(0);
      const [before] = await tx`select content_text from kb_nodes where id = ${t.pub}`;
      expect(before.content_text).toBe("Администраторы открывают кассу");
      expect(await failure(tx, () => tx`select kb_publish(${t.pub})`)).toContain("kb_forbidden");

      await as(tx, t.editor);
      await tx`select kb_publish(${t.pub})`;
      await asServer(tx);
      const [after] = await tx`select content_text, published_by, status from kb_nodes where id = ${t.pub}`;
      expect(after.content_text).toBe("Новый регламент кассы и сейфа");
      expect(after.published_by).toBe(t.editor);
      expect(await tx`select node_id from kb_drafts where node_id = ${t.pub}`).toHaveLength(0);
      const revs = await tx`select title from kb_revisions where node_id = ${t.pub}`;
      expect(revs).toHaveLength(1);

      // Черновик статьи-черновика публикуется и становится виден читателю.
      await as(tx, t.editor);
      await tx`select kb_save_draft(${t.draft}, ${JSON.stringify(doc("Текст"))}::text::jsonb, null)`;
      await tx`select kb_publish(${t.draft})`;
      await asServer(tx);
      expect(await visible(tx, t.reader, t.b)).toContain("Черновик");
    }));

  test("поиск: начало слова и окончания, внутри папки, читатель не находит черновики", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      const office = await node(tx, t.b, { kind: "folder", title: "Офис" });
      await node(tx, t.b, { parent: office, title: "Касса офиса", text: "Касса в офисе" });
      await node(tx, t.b, { parent: t.folder, title: "Скрытая касса", status: "draft", text: "касса" });

      await as(tx, t.reader);
      let rows = (await tx`select title, snippet from kb_search('админ', ${t.b}, null, 30)`) as Row[];
      expect(rows.map((r) => r.title)).toEqual(["Администратор", "Открытие смены"]);
      expect(rows[1].snippet).toContain("⟦Администраторы⟧");

      rows = (await tx`select title from kb_search('кассы', ${t.b}, null, 30)`) as Row[];
      expect(rows.map((r) => r.title).sort()).toEqual(["Касса офиса", "Открытие смены"]);
      rows = (await tx`select title from kb_search('касса', ${t.b}, ${office}, 30)`) as Row[];
      expect(rows.map((r) => r.title)).toEqual(["Касса офиса"]);
      rows = (await tx`select title from kb_search('%', ${t.b}, null, 30)`) as Row[];
      expect(rows).toHaveLength(0);

      await as(tx, t.editor);
      rows = (await tx`select title from kb_search('касса', ${t.b}, null, 30)`) as Row[];
      expect(rows.map((r) => r.title)).toContain("Скрытая касса");
      await asServer(tx);
    }));

  test("копия статьи — черновиком сразу под оригиналом", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      await as(tx, t.editor);
      const [{ id }] = await tx`select kb_copy_node(${t.pub}) as id`;
      const order = await tx`select title, status from kb_nodes where parent_id = ${t.folder} order by sort_order`;
      expect((order as Row[]).map((r) => r.title)).toEqual(["Открытие смены", "Открытие смены (копия)", "Черновик"]);
      const [d] = await tx`select content from kb_drafts where node_id = ${id}`;
      expect(JSON.stringify(d.content)).toContain("Администраторы открывают кассу");
      await asServer(tx);
    }));

  test("чтение и отчёт: папки не считаются, доступ — у владельцев и выданных", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      await as(tx, t.reader);
      await tx`select kb_mark_read(${t.pub})`;
      await tx`select kb_mark_read(${t.pub})`;
      await tx`select kb_mark_read(${t.draft})`;
      await tx`select kb_mark_read(${t.folder})`;
      expect(await failure(tx, () => tx`select * from kb_report(${t.b})`)).toContain("kb_forbidden");
      await as(tx, t.stranger);
      await tx`select kb_mark_read(${t.pub})`;
      await asServer(tx);
      const reads = await tx`select node_id, read_count from kb_reads`;
      expect(reads).toHaveLength(1);
      expect(reads[0].read_count).toBe(1);

      await as(tx, t.editor);
      const report = (await tx`select * from kb_report(${t.b}) order by title`) as Row[];
      expect(report.map((r) => r.title)).toEqual(["Открытие смены", "Черновик"]);
      // Список «у кого доступ» наружу не выдан — только через отчёт.
      expect(await failure(tx, () => tx`select * from kb_base_audience(${t.b})`)).toContain(
        "permission denied",
      );
      // Аудитория — читатель и редактор (владелец не в счёт): 1 из 2.
      expect(report[0].readers_count).toBe(1);
      expect(report[0].access_count).toBe(2);

      await tx`insert into kb_nodes (base_id, kind, title) values (${t.b}, 'article', 'Своя')`;
      const authors = (await tx`select * from kb_authors(${t.b})`) as Row[];
      expect(authors.map((r) => r.user_id)).toContain(t.editor);
      await as(tx, t.stranger);
      expect(await failure(tx, () => tx`select * from kb_authors(${t.b})`)).toContain("kb_forbidden");
      await as(tx, t.editor);
      const readers = (await tx`select * from kb_article_readers(${t.pub})`) as Row[];
      expect(readers.find((r) => r.user_id === t.reader)?.read_count).toBe(1);
      expect(readers.find((r) => r.user_id === t.editor)?.read_count).toBe(0);
      expect(readers.some((r) => r.user_id === t.stranger)).toBe(false);
      expect(readers.some((r) => r.user_id === t.owner)).toBe(false);

      // Кто правил статью — её автор, а не читатель: из аудитории выпадает,
      // его собственные открытия в отчёт не идут.
      await tx`select kb_save_draft(${t.pub}, ${JSON.stringify(doc("правка"))}::text::jsonb, null)`;
      await tx`select kb_mark_read(${t.pub})`;
      const [after] = (await tx`select * from kb_report(${t.b}) where id = ${t.pub}`) as Row[];
      expect(after.access_count).toBe(1);
      expect(after.readers_count).toBe(1);
      const left = (await tx`select * from kb_article_readers(${t.pub})`) as Row[];
      expect(left.map((r) => r.user_id)).toEqual([t.reader]);
      await asServer(tx);
    }));

  test("файлы: читатель базы читает, пишет только редактор, чужая база закрыта", () =>
    scenario(async (tx) => {
      const t = await setup(tx);
      const other = await base(tx, "Другая");
      // В Supabase у ролей запросов есть доступ к схеме storage, в заглушках — нет.
      await tx`grant usage on schema storage to authenticated`;
      await tx`grant select, insert, update, delete on storage.objects to authenticated`;
      await tx`insert into storage.objects (bucket_id, name) values ('kb-media', ${`${t.b}/${t.pub}/a.png`}),
                                                                   ('kb-media', ${`${other}/x/b.png`})`;
      await as(tx, t.reader);
      const seen = (await tx`select name from storage.objects where bucket_id = 'kb-media'`) as Row[];
      expect(seen.map((r) => r.name)).toEqual([`${t.b}/${t.pub}/a.png`]);
      expect(
        await failure(tx, () => tx`insert into storage.objects (bucket_id, name) values ('kb-media', ${`${t.b}/${t.pub}/c.png`})`),
      ).toContain("row-level security");
      await as(tx, t.editor);
      await tx`insert into storage.objects (bucket_id, name) values ('kb-media', ${`${t.b}/${t.pub}/c.png`})`;
      expect(
        await failure(tx, () => tx`insert into storage.objects (bucket_id, name) values ('kb-media', ${`${other}/x/c.png`})`),
      ).toContain("row-level security");
      await asServer(tx);
    }));
});
