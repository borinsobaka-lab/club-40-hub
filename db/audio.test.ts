/**
 * Тесты «Аудиоаналитики» (db/migrations/2026-10-30_audio_analytics.sql):
 * права (свои смены / все смены / настройки, без права — ничего), запуск
 * разбора и зависший разбор, удаление смены с очередью стирания аудио,
 * «согласен / не согласен», договорённости (итог подводит «все смены»),
 * версии промптов, список смен и сводка за период.
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

describe.skipIf(!url)("аудиоаналитика (база)", () => {
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
    const [{ id }] = await tx`insert into auth.users (email) values (${`u-${crypto.randomUUID()}@example.com`}) returning id`;
    await tx`set local session_replication_role = origin`;
    return id as string;
  }

  /** Человек модели прав с сетевыми правами (как после пересчёта ролей). */
  async function person(tx: Tx, rights: string[]): Promise<string> {
    const id = await user(tx);
    await tx`insert into access_user_rights (user_id, rights, portal) values (${id}, ${rights}, true)`;
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

  /** Запрос от имени человека; потом — снова сервер. */
  async function from<T>(tx: Tx, who: string, run: (t: Tx) => Promise<T>): Promise<T> {
    await as(tx, who);
    try {
      return await run(tx);
    } finally {
      await asServer(tx);
    }
  }

  async function errorAs(tx: Tx, who: string, run: (t: Tx) => Promise<unknown>): Promise<string | null> {
    await as(tx, who);
    const message = await failure(tx, () => run(tx));
    await asServer(tx);
    return message;
  }

  type World = {
    location: string;
    anna: string;
    maria: string;
    recAnna: string;
    recMaria: string;
    dialogAnna: string;
    metric: string;
  };

  /** Точка, два менеджера, по разобранной смене у каждого, метрика с оценками. */
  async function world(tx: Tx, annaUser: string | null = null): Promise<World> {
    const [{ id: location }] = await tx`insert into aa_locations (name) values (${`Ваке ${crypto.randomUUID()}`}) returning id`;
    const [{ id: anna }] = await tx`insert into aa_managers (full_name, user_id) values ('Анна', ${annaUser}) returning id`;
    const [{ id: maria }] = await tx`insert into aa_managers (full_name) values ('Мария') returning id`;
    const [{ id: recAnna }] = await tx`
      insert into aa_recordings (location_id, manager_id, date, status, speech_duration_s, cost_usd)
      values (${location}, ${anna}, '2026-10-20', 'done', 3600, 0.5) returning id`;
    const [{ id: recMaria }] = await tx`
      insert into aa_recordings (location_id, manager_id, date, status, speech_duration_s, cost_usd)
      values (${location}, ${maria}, '2026-10-21', 'done', 1800, 0.25) returning id`;
    const [{ id: metric }] = await tx`
      insert into aa_metrics (name, prompt, scale_max) values ('Продажа', 'оцени', 10) returning id`;
    const dialogs: string[] = [];
    for (const [rec, score] of [
      [recAnna, 8],
      [recMaria, 4],
    ] as const) {
      const [{ id: dialog }] = await tx`
        insert into aa_dialogs (recording_id, start_s, end_s, type, brief)
        values (${rec}, 60, 300, 'sale', 'купила абонемент') returning id`;
      await tx`insert into aa_dialog_turns (dialog_id, speaker_label, start_s, end_s, text)
               values (${dialog}, 'speaker_0', 60, 65, 'Здравствуйте')`;
      await tx`insert into aa_metric_evaluations (recording_id, dialog_id, metric_id, applicable, score)
               values (${rec}, ${dialog}, ${metric}, true, ${score})`;
      await tx`insert into aa_day_summaries (recording_id, dialogs_total, sales_count, conversion)
               values (${rec}, 2, 1, 0.5)`;
      dialogs.push(dialog as string);
    }
    return { location, anna, maria, recAnna, recMaria, dialogAnna: dialogs[0], metric };
  }

  test("права: свои смены, все смены, без права — ничего; справочники правит только «настройки»", () =>
    scenario(async (tx) => {
      const annaUser = await person(tx, ["audio.own"]);
      const viewer = await person(tx, ["audio.view"]);
      const admin = await person(tx, ["audio.manage"]);
      const nobody = await person(tx, ["kb.admin"]);
      const w = await world(tx, annaUser);

      const recs = async (who: string) =>
        (await from(tx, who, (t) => t`select id from aa_recordings where location_id = ${w.location}`))
          .map((r: { id: string }) => r.id)
          .sort();

      expect(await recs(annaUser)).toEqual([w.recAnna]);
      expect(await recs(viewer)).toEqual([w.recAnna, w.recMaria].sort());
      expect(await recs(admin)).toEqual([w.recAnna, w.recMaria].sort());
      expect(await recs(nobody)).toEqual([]);

      // Реплики чужой смены «своим» не видны.
      const turns = await from(tx, annaUser, (t) => t`select dialog_id from aa_dialog_turns`);
      expect(turns.map((r: { dialog_id: string }) => r.dialog_id)).toEqual([w.dialogAnna]);

      // Справочники читает любой с правом раздела, правит — «настройки».
      const metricsSeen = await from(tx, annaUser, (t) => t`select id from aa_metrics where id = ${w.metric}`);
      expect(metricsSeen.length).toBe(1);
      expect(await from(tx, nobody, (t) => t`select id from aa_metrics`)).toEqual([]);
      expect(
        await errorAs(tx, viewer, (t) => t`insert into aa_metrics (name, prompt) values ('x', 'y')`),
      ).not.toBeNull();
      await from(tx, admin, (t) => t`insert into aa_metrics (name, prompt) values ('Новая', 'оцени')`);
      const [{ position }] = await tx`select position from aa_metrics where name = 'Новая'`;
      expect(position).toBeGreaterThan(0);

      const access = await from(tx, annaUser, (t) => t`select aa_access() as r`);
      expect(access[0].r).toMatchObject({ own: true, view: false, manage: false, manager_ids: [w.anna] });

      // Аудиофайлы и очередь стирания — только сервису.
      expect(await errorAs(tx, admin, (t) => t`select * from aa_storage_purge`)).not.toBeNull();
    }));

  test("владелец клуба вне модели прав — всё; «свои» без привязки менеджера — ничего", () =>
    scenario(async (tx) => {
      const owner = await user(tx);
      const [{ id: studio }] = await tx`insert into studios (name) values ('Клуб') returning id`;
      await tx`insert into user_roles (user_id, role, studio_id) values (${owner}, 'owner', ${studio})`;
      const lonely = await person(tx, ["audio.own"]);
      await world(tx);
      const a = await from(tx, owner, (t) => t`select aa_access() as r`);
      expect(a[0].r).toMatchObject({ own: true, view: true, manage: true });
      expect((await from(tx, owner, (t) => t`select count(*)::int as n from aa_recordings`))[0].n).toBeGreaterThan(1);
      expect((await from(tx, lonely, (t) => t`select count(*)::int as n from aa_recordings`))[0].n).toBe(0);
    }));

  test("запуск разбора: только «настройки», не во время записи, без двойной очереди, зависший — заново", () =>
    scenario(async (tx) => {
      const admin = await person(tx, ["audio.manage"]);
      const viewer = await person(tx, ["audio.view"]);
      const w = await world(tx);

      expect(await errorAs(tx, viewer, (t) => t`select aa_recording_process(${w.recAnna})`)).toContain(
        "aa_forbidden",
      );
      await from(tx, admin, (t) => t`select aa_recording_process(${w.recAnna}, true)`);
      const [rec] = await tx`select status, process_full, queued_by from aa_recordings where id = ${w.recAnna}`;
      expect(rec).toMatchObject({ status: "queued", process_full: true, queued_by: admin });
      expect(await errorAs(tx, admin, (t) => t`select aa_recording_process(${w.recAnna})`)).toContain("aa_busy");

      // Статус не двигался три часа — воркер погиб, можно запустить снова.
      await tx`update aa_recordings set status = 'processing', status_changed_at = now() - interval '4 hours'
               where id = ${w.recAnna}`;
      await from(tx, admin, (t) => t`select aa_recording_process(${w.recAnna})`);
      const [again] = await tx`select status, process_full from aa_recordings where id = ${w.recAnna}`;
      expect(again).toMatchObject({ status: "queued", process_full: false });

      // Смена ещё пишется — разбирать нечего; закрыть можно, только если есть сегменты.
      const [{ id: live }] = await tx`
        insert into aa_recordings (location_id, date) values (${w.location}, '2026-10-22') returning id`;
      expect(await errorAs(tx, admin, (t) => t`select aa_recording_process(${live})`)).toContain(
        "aa_still_recording",
      );
      expect(await errorAs(tx, admin, (t) => t`select aa_recording_force_finish(${live})`)).toContain(
        "aa_no_segments",
      );
      await tx`insert into aa_segments (recording_id, idx, audio_uri) values (${live}, 0, 'recordings/x/seg_00000.opus')`;
      await from(tx, admin, (t) => t`select aa_recording_force_finish(${live})`);
      const [closed] = await tx`select status from aa_recordings where id = ${live}`;
      expect(closed.status).toBe("uploaded");
    }));

  test("удаление смены: всё каскадом, папка аудио — в очередь стирания; точку со сменами не удалить", () =>
    scenario(async (tx) => {
      const admin = await person(tx, ["audio.manage"]);
      const w = await world(tx);
      await tx`insert into aa_agreements (manager_id, recording_id, day_date, text)
               values (${w.anna}, ${w.recAnna}, '2026-10-20', 'Называть цену после выгоды')`;
      // Договорённость Марии отмечена на смене Анны — ссылка снимается, сама остаётся.
      const [{ id: other }] = await tx`
        insert into aa_agreements (manager_id, recording_id, day_date, text, status, resolved_recording_id)
        values (${w.maria}, ${w.recMaria}, '2026-10-21', 'Предлагать пробное', 'done', ${w.recAnna}) returning id`;

      await from(tx, admin, (t) => t`select aa_recording_delete(${w.recAnna})`);
      expect((await tx`select count(*)::int as n from aa_dialogs where recording_id = ${w.recAnna}`)[0].n).toBe(0);
      expect((await tx`select count(*)::int as n from aa_agreements where recording_id = ${w.recAnna}`)[0].n).toBe(0);
      const [kept] = await tx`select resolved_recording_id from aa_agreements where id = ${other}`;
      expect(kept.resolved_recording_id).toBeNull();
      const purge = await tx`select prefix from aa_storage_purge where prefix = ${`recordings/${w.recAnna}/`}`;
      expect(purge.length).toBe(1);

      const message = await errorAs(tx, admin, (t) => t`delete from aa_locations where id = ${w.location}`);
      expect(message).toContain("aa_location_has_recordings");

      // Удалённая сборка приложения — архив в очередь стирания.
      const [{ id: rel }] = await tx`
        insert into aa_app_releases (platform, version, archive_uri, signature)
        values ('darwin', '0.5.0', 'app-releases/darwin/0.5.0/app.tar.gz', 'sig') returning id`;
      await from(tx, admin, (t) => t`delete from aa_app_releases where id = ${rel}`);
      const relPurge = await tx`select 1 from aa_storage_purge where prefix = 'app-releases/darwin/0.5.0/app.tar.gz'`;
      expect(relPurge.length).toBe(1);
    }));

  test("согласен / не согласен: один голос на оценку, снять — только свой; чужая смена — не найдена", () =>
    scenario(async (tx) => {
      const annaUser = await person(tx, ["audio.own"]);
      const viewer = await person(tx, ["audio.view"]);
      const w = await world(tx, annaUser);
      await tx`update profiles set full_name = 'Анна Петрова' where id = ${annaUser}`;

      await from(tx, annaUser, (t) => t`select aa_feedback_set(${w.dialogAnna}, ${w.metric}, false, 'клиентка уже купила')`);
      await from(tx, annaUser, (t) => t`select aa_feedback_set(${w.dialogAnna}, ${w.metric}, true, '')`);
      const votes = await tx`select agree, author_id, subject_name from aa_feedback where dialog_id = ${w.dialogAnna}`;
      expect(votes.length).toBe(1);
      expect(votes[0]).toMatchObject({ agree: true, author_id: annaUser, subject_name: "Анна" });

      const [{ id: dialogMaria }] = await tx`select id from aa_dialogs where recording_id = ${w.recMaria}`;
      expect(
        await errorAs(tx, annaUser, (t) => t`select aa_feedback_set(${dialogMaria}, ${w.metric}, false, '')`),
      ).toContain("aa_not_found");

      await from(tx, viewer, (t) => t`select aa_feedback_set(${w.dialogAnna}, ${w.metric}, false, 'завышено')`);
      // Чужой голос не удаляется (политика молча не находит строку).
      await from(tx, annaUser, (t) => t`delete from aa_feedback where author_id = ${viewer}`);
      expect((await tx`select count(*)::int as n from aa_feedback where dialog_id = ${w.dialogAnna}`)[0].n).toBe(2);
      await from(tx, annaUser, (t) => t`delete from aa_feedback where author_id = ${annaUser}`);
      expect((await tx`select count(*)::int as n from aa_feedback where dialog_id = ${w.dialogAnna}`)[0].n).toBe(1);
    }));

  test("договорённости: записывает и «свой», итог подводит только «все смены»", () =>
    scenario(async (tx) => {
      const annaUser = await person(tx, ["audio.own"]);
      const viewer = await person(tx, ["audio.view"]);
      const w = await world(tx, annaUser);

      const [{ id }] = await from(tx, annaUser, (t) =>
        t`select aa_agreement_create(${w.recAnna}, ' Называть цену после выгоды ', ${w.dialogAnna}) as id`,
      );
      const [row] = await tx`select manager_id, manager_name, day_date, dialog_start_s, text, status from aa_agreements where id = ${id}`;
      expect(row).toMatchObject({ manager_id: w.anna, manager_name: "Анна", dialog_start_s: 60, text: "Называть цену после выгоды", status: "open" });

      expect(
        await errorAs(tx, annaUser, (t) => t`select aa_agreement_update(${id}, 'done')`),
      ).toContain("aa_forbidden");
      // Пояснение к своей договорённости менеджер оставить может.
      await from(tx, annaUser, (t) => t`select aa_agreement_update(${id}, null, null, 'попробовала на двух клиентках')`);

      await from(tx, viewer, (t) => t`select aa_agreement_update(${id}, 'done', null, null, ${w.recMaria})`);
      const [done] = await tx`select status, resolved_at, resolved_recording_id, resolution_note from aa_agreements where id = ${id}`;
      expect(done.status).toBe("done");
      expect(done.resolved_at).not.toBeNull();
      expect(done.resolved_recording_id).toBe(w.recMaria);
      expect(done.resolution_note).toBe("попробовала на двух клиентках");

      await from(tx, viewer, (t) => t`select aa_agreement_update(${id}, 'open')`);
      const [reopened] = await tx`select resolved_at, resolved_recording_id from aa_agreements where id = ${id}`;
      expect(reopened).toMatchObject({ resolved_at: null, resolved_recording_id: null });

      // Чужая смена — не найдена.
      expect(
        await errorAs(tx, annaUser, (t) => t`select aa_agreement_create(${w.recMaria}, 'текст')`),
      ).toContain("aa_not_found");
      const open = await from(tx, annaUser, (t) => t`select aa_access() as r`);
      expect(open[0].r.open_agreements).toBe(1);
    }));

  test("промпты: правка — новая версия, активна последняя", () =>
    scenario(async (tx) => {
      const admin = await person(tx, ["audio.manage"]);
      const viewer = await person(tx, ["audio.view"]);
      const [{ v }] = await tx`select max(version) as v from aa_prompts where key = 'daily_summary'`;
      expect(await errorAs(tx, viewer, (t) => t`select aa_prompt_save('daily_summary', 'x')`)).toContain("aa_forbidden");
      await from(tx, admin, (t) => t`select aa_prompt_save('daily_summary', 'Итог: {{stats}} {{analyses}}', 'claude-sonnet-5')`);
      const rows = await tx`select version, active, model, content from aa_prompts where key = 'daily_summary' order by version`;
      expect(rows.filter((r: { active: boolean }) => r.active).length).toBe(1);
      expect(rows.at(-1)).toMatchObject({ version: v + 1, active: true, model: "claude-sonnet-5" });
      expect(await errorAs(tx, admin, (t) => t`select aa_prompt_save('daily_summary', '  ')`)).toContain("aa_empty_prompt");
    }));

  test("список смен и сводка за период: показатели, сравнение с прошлым периодом, «свои» — только свои", () =>
    scenario(async (tx) => {
      const annaUser = await person(tx, ["audio.own"]);
      const viewer = await person(tx, ["audio.view"]);
      const w = await world(tx, annaUser);
      // Смена Анны прошлого периода с оценкой 6.
      const [{ id: old }] = await tx`
        insert into aa_recordings (location_id, manager_id, date, status) values (${w.location}, ${w.anna}, '2026-10-13', 'done') returning id`;
      const [{ id: oldDialog }] = await tx`
        insert into aa_dialogs (recording_id, start_s, end_s, type) values (${old}, 0, 10, 'sale') returning id`;
      await tx`insert into aa_metric_evaluations (recording_id, dialog_id, metric_id, applicable, score)
               values (${old}, ${oldDialog}, ${w.metric}, true, 6)`;

      const [{ r: days }] = await from(tx, viewer, (t) => t`select aa_days(${[w.location]}::uuid[], 10) as r`);
      expect(days.map((d: { id: string }) => d.id)).toEqual([w.recMaria, w.recAnna, old]);
      expect(days[1]).toMatchObject({ manager_name: "Анна", dialogs_total: 2, sales_count: 1, stale: false });
      expect(days[1].metric_stats).toEqual([
        { metric_id: w.metric, name: "Продажа", scale_max: 10, triggered: 1, avg: 8 },
      ]);

      const [{ r: sum }] = await from(tx, viewer, (t) =>
        t`select aa_summary('2026-10-14'::date, '2026-10-27'::date, null, ${[w.location]}::uuid[]) as r`,
      );
      expect(sum.prev_date_from).toBe("2026-09-30");
      expect(sum.totals).toMatchObject({ shifts: 2, dialogs: 4, sales: 2, conversion: 0.5, cost_usd: 0.75 });
      expect(sum.previous.shifts).toBe(1);
      expect(sum.metrics[0]).toMatchObject({ triggered: 2, avg: 6, prev_avg: 6 });
      expect(sum.managers.map((m: { full_name: string }) => m.full_name).sort()).toEqual(["Анна", "Мария"]);
      expect(sum.trend.map((p: { date: string }) => p.date)).toEqual(["2026-10-20", "2026-10-21"]);

      const [{ r: mine }] = await from(tx, annaUser, (t) =>
        t`select aa_summary('2026-10-14'::date, '2026-10-27'::date, null, ${[w.location]}::uuid[]) as r`,
      );
      expect(mine.totals.shifts).toBe(1);
      expect(mine.metrics[0]).toMatchObject({ avg: 8, prev_avg: 6 });

      expect(
        await errorAs(tx, viewer, (t) => t`select aa_summary('2026-10-14'::date, '2026-10-01'::date)`),
      ).toContain("aa_bad_period");
    }));
});
