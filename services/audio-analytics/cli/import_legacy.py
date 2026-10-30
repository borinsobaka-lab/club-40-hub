"""Перенос данных из прежнего проекта audio-analitics в таблицы aa_* портала.

    python -m cli.import_legacy --old-database-url postgres://… [--copy-audio] [--dry-run]

Новая база — DATABASE_URL из окружения сервиса (или --database-url).

Что переносится, с прежними идентификаторами (ссылки из отчётов, закладки
и имена папок в хранилище остаются верными):
  locations → aa_locations, employees → aa_managers (без учётных записей:
  связать менеджера с человеком портала — в админке, «Менеджеры»),
  day_recordings → aa_recordings, segments, transcripts, dialogs,
  dialog_turns, analysis_metrics → aa_metrics, metric_evaluations,
  metrics_daily → aa_day_summaries, prompt_templates (только
  dialog_segmentation и daily_summary) → aa_prompts, dialog_feedback (только
  с метрикой) → aa_feedback, agreements, app_releases.
Не переносятся: скрипты, CRM, логины и пароли сотрудников, script_templates,
промпт sale_analysis — этих частей на портале нет.

Повторный запуск безопасен: строка с тем же id пропускается (on conflict do
nothing), поэтому перенос можно повторить после того, как в старой системе
появились новые смены.

Стартовый набор портала заменяется прежним:
  * метрики миграции удаляются, если по ним ещё нет ни одной оценки, — иначе
    в справочнике оказались бы два комплекта одинаковых метрик;
  * версии промптов с подписью «Стартовый набор» заменяются историей
    промптов прежнего проекта; если промпт на портале уже правили — его
    история не трогается.

Смены «в очереди» и «в обработке» прежней системы переносятся как «ждёт
разбора»: иначе воркер портала сразу взялся бы их разбирать — за деньги и
без спроса.

Файлы: ключи в хранилище прежние (recordings/<id>/…, app-releases/…).
--copy-audio копирует их из прежнего S3/R2 (OLD_S3_*) в текущее хранилище
сервиса потоком, пропуская уже скопированные. Аудио смен старше
AUDIO_RETENTION_DAYS не копируется (его всё равно стёр бы срок хранения) —
только расшифровки, чтобы такие смены можно было пересчитать.
"""
import argparse
import sys
from datetime import date, timedelta

import psycopg2
import psycopg2.extras
from psycopg2.extras import Json, execute_values

from app import storage
from app.config import get_settings, plain_database_url

SEEDED_PROMPT_AUTHOR = "Стартовый набор"
PROMPT_KEYS = ("dialog_segmentation", "daily_summary")
DIALOG_TYPES = {"sale", "consultation", "refusal", "service", "irrelevant"}
RECORDING_STATUSES = {"recording", "uploaded", "queued", "processing", "done", "error"}
AGREEMENT_STATUSES = {"open", "done", "missed", "cancelled"}
PLATFORMS = {"darwin", "windows", "linux"}
BATCH = 1000


class Importer:
    def __init__(self, old, new, out=print):
        self.old = old
        self.new = new
        self.out = out
        self.report: list[tuple[str, int, int]] = []
        self.notes: list[str] = []
        self.location_map: dict[str, str] = {}

    # --- служебное ---------------------------------------------------------------------

    def old_tables(self) -> set[str]:
        with self.old.cursor() as cur:
            cur.execute("select table_name from information_schema.tables where table_schema = 'public'")
            return {r[0] for r in cur.fetchall()}

    def old_columns(self, table: str) -> set[str]:
        with self.old.cursor() as cur:
            cur.execute(
                "select column_name from information_schema.columns "
                "where table_schema = 'public' and table_name = %s",
                (table,),
            )
            return {r[0] for r in cur.fetchall()}

    def col(self, table: str, column: str, default: str = "null") -> str:
        """Колонка, если она есть в прежней базе, иначе значение по умолчанию:
        прежняя база могла остановиться на любой из своих миграций."""
        return column if column in self.old_columns(table) else f"{default}"

    def rows(self, sql: str, params=None):
        """Строки прежней базы потоком — реплик за всё время сотни тысяч."""
        with self.old.cursor(name=f"imp_{len(self.report)}_{abs(hash(sql)) % 10**8}") as cur:
            cur.itersize = BATCH
            cur.execute(sql, params)
            batch = []
            for row in cur:
                batch.append(row)
                if len(batch) >= BATCH:
                    yield batch
                    batch = []
            if batch:
                yield batch

    def insert(self, label: str, sql: str, batches, template: str | None = None) -> int:
        """Вставить пачками с «on conflict do nothing»; в отчёт — сколько новых,
        сколько уже было."""
        inserted = total = 0
        with self.new.cursor() as cur:
            for batch in batches:
                if not batch:
                    continue
                total += len(batch)
                res = execute_values(
                    cur, sql + " on conflict do nothing returning 1", batch,
                    template=template, page_size=BATCH, fetch=True,
                )
                inserted += len(res)
        self.report.append((label, inserted, total - inserted))
        return inserted

    # --- таблицы --------------------------------------------------------------------------

    def locations(self) -> None:
        t = "locations"
        with self.new.cursor() as cur:
            cur.execute("select id::text, lower(btrim(name)) from aa_locations")
            existing_ids, by_name = set(), {}
            for lid, lname in cur.fetchall():
                existing_ids.add(lid)
                by_name[lname] = lid
        rows = []
        matched = 0
        for batch in self.rows(
            f"select id::text, name, {self.col(t, 'address', chr(39) * 2)}, "
            f"{self.col(t, 'timezone', repr('Asia/Tbilisi'))}, {self.col(t, 'active', 'true')} "
            f"from locations order by name"
        ):
            for lid, name, address, tz, active in batch:
                name = (name or "").strip()[:200] or "Без названия"
                key = name.lower()
                if lid not in existing_ids and key in by_name:
                    # Точку уже завели на портале под тем же названием — смены
                    # прежней точки достаются ей, второй «Ваке» не нужен.
                    self.location_map[lid] = by_name[key]
                    matched += 1
                    continue
                self.location_map[lid] = lid
                by_name.setdefault(key, lid)
                rows.append((lid, name, (address or "")[:500], tz or "Asia/Tbilisi", bool(active)))
        self.insert(
            "Точки продажи",
            "insert into aa_locations (id, name, address, timezone, active) values %s",
            [rows],
        )
        if matched:
            self.notes.append(f"точек сопоставлено по названию с уже заведёнными на портале: {matched}")

    def managers(self) -> None:
        t = "employees"

        def fix(name: str) -> str:
            name = (name or "").strip()[:200]
            return name if len(name) >= 2 else f"{name or 'Без имени'} (менеджер)"[:200]

        self.insert(
            "Менеджеры",
            "insert into aa_managers (id, full_name, active, created_at) values %s",
            (
                [(r[0], fix(r[1]), bool(r[2]), r[3]) for r in batch]
                for batch in self.rows(
                    f"select id::text, full_name, active, {self.col(t, 'created_at', 'now()')} from employees"
                )
            ),
        )

    def recordings(self) -> None:
        t = "day_recordings"
        c = lambda name, default="null": self.col(t, name, default)  # noqa: E731
        sql = (
            "select id::text, location_id::text, employee_id::text, date, status, "
            f"{c('status_detail', chr(39) * 2)}, {c('status_changed_at')}, raw_audio_uri, "
            "total_duration_s, speech_duration_s, "
            f"{c('asr_seconds')}, {c('llm_input_tokens', '0')}, {c('llm_output_tokens', '0')}, "
            f"{c('llm_calls', '0')}, {c('cost_usd')}, created_at from day_recordings"
        )
        requeued = 0

        def convert(batch):
            nonlocal requeued
            out = []
            for (rid, loc, emp, day, status, detail, changed, raw, total, speech,
                 asr, tin, tout, calls, cost, created) in batch:
                status = status if status in RECORDING_STATUSES else "error"
                if status in ("queued", "processing"):
                    requeued += 1
                    status = "uploaded"
                    detail = "перенесена из прежней системы незаконченной — запустите разбор заново"
                out.append((
                    rid, self.location_map.get(loc, loc), emp, day, status, detail or "",
                    changed or created, raw, total, speech, asr, tin or 0, tout or 0, calls or 0, cost, created,
                ))
            return out

        self.insert(
            "Смены",
            "insert into aa_recordings (id, location_id, manager_id, date, status, status_detail, "
            "status_changed_at, raw_audio_uri, total_duration_s, speech_duration_s, asr_seconds, "
            "llm_input_tokens, llm_output_tokens, llm_calls, cost_usd, created_at) values %s",
            (convert(b) for b in self.rows(sql)),
        )
        if requeued:
            self.notes.append(f"смен «в очереди / в обработке» перенесено как «ждёт разбора»: {requeued}")

    def simple(self) -> None:
        """Таблицы, которые переносятся колонка в колонку."""
        self.insert(
            "Сегменты записи",
            "insert into aa_segments (id, recording_id, idx, audio_uri, uploaded_at) values %s",
            self.rows(
                "select id::text, day_recording_id::text, idx, audio_uri, uploaded_at "
                "from segments where idx >= 0"
            ),
        )
        self.insert(
            "Расшифровки",
            "insert into aa_transcripts (id, recording_id, asr_provider, language_hint, raw_json_uri, text, "
            "created_at) values %s",
            self.rows(
                "select id::text, day_recording_id::text, coalesce(asr_provider, 'elevenlabs'), "
                "coalesce(language_hint, 'auto'), raw_json_uri, coalesce(text, ''), created_at from transcripts"
            ),
        )
        self.insert(
            "Разговоры",
            "insert into aa_dialogs (id, recording_id, start_s, end_s, type, outcome, brief) values %s",
            (
                [(i, r, s, e, ty if ty in DIALOG_TYPES else "irrelevant", o, b or "")
                 for i, r, s, e, ty, o, b in batch]
                for batch in self.rows(
                    "select id::text, day_recording_id::text, start_s, end_s, type, outcome, brief from dialogs"
                )
            ),
        )
        self.insert(
            "Реплики",
            "insert into aa_dialog_turns (id, dialog_id, speaker_label, start_s, end_s, text) values %s",
            self.rows(
                "select id::text, dialog_id::text, speaker_label, start_s, end_s, coalesce(text, '') "
                "from dialog_turns"
            ),
        )

    def metrics(self) -> None:
        if "analysis_metrics" not in self.old_tables():
            return
        with self.old.cursor() as cur:
            cur.execute("select id::text from analysis_metrics")
            old_ids = [r[0] for r in cur.fetchall()]
        with self.new.cursor() as cur:
            cur.execute("select exists (select 1 from aa_metric_evaluations)")
            has_evals = cur.fetchone()[0]
            if old_ids and not has_evals:
                # Оценок ещё нет — стартовые метрики миграции никто не применял:
                # их место занимает прежний, уже откалиброванный набор.
                cur.execute("delete from aa_metrics where not (id::text = any (%s))", (old_ids,))
                if cur.rowcount:
                    self.notes.append(f"стартовых метрик портала заменено прежними: {cur.rowcount}")
            elif old_ids:
                self.notes.append(
                    "на портале уже есть оценки — стартовые метрики оставлены рядом с прежними, "
                    "проверьте список метрик и выключите лишние"
                )
        truncated = 0

        def convert(batch):
            nonlocal truncated
            out = []
            for i, name, prompt, scale, active, pos, created in batch:
                prompt = prompt or ""
                if len(prompt) > 60000:
                    truncated += 1
                    prompt = prompt[:60000]
                out.append((i, (name or "").strip()[:200] or "Без названия", prompt,
                            scale if scale in (5, 10) else 10, bool(active), pos or 0, created, created))
            return out

        self.insert(
            "Метрики",
            "insert into aa_metrics (id, name, prompt, scale_max, active, position, created_at, updated_at) "
            "values %s",
            (convert(b) for b in self.rows(
                "select id::text, name, prompt, scale_max, active, position, created_at from analysis_metrics"
            )),
        )
        if truncated:
            self.notes.append(f"инструкции метрик длиннее 60 000 знаков обрезаны: {truncated}")
        self.insert(
            "Оценки по метрикам",
            "insert into aa_metric_evaluations (id, recording_id, dialog_id, metric_id, applicable, score, "
            "good, bad, comment) values %s",
            (
                [(i, r, d, m, bool(a), s, Json(g or []), Json(b or []), c or "")
                 for i, r, d, m, a, s, g, b, c in batch]
                for batch in self.rows(
                    "select id::text, day_recording_id::text, dialog_id::text, metric_id::text, applicable, "
                    "score, good_json, bad_json, comment from metric_evaluations"
                )
            ),
        )

    def day_summaries(self) -> None:
        self.insert(
            "Итоги смен",
            "insert into aa_day_summaries (recording_id, dialogs_total, sales_count, conversion, summary) "
            "values %s",
            (
                [(r, t or 0, s or 0, c, Json(j) if j is not None else None) for r, t, s, c, j in batch]
                for batch in self.rows(
                    "select day_recording_id::text, dialogs_total, sales_count, conversion, summary_json "
                    "from metrics_daily where day_recording_id is not null"
                )
            ),
        )

    def prompts(self) -> None:
        t = "prompt_templates"
        inserted_total = skipped_total = 0
        for key in PROMPT_KEYS:
            with self.old.cursor() as cur:
                cur.execute(
                    f"select id::text, key, name, coalesce(description, ''), content, model, version, active, "
                    f"{self.col(t, 'updated_by')}, created_at from prompt_templates "
                    "where key = %s order by version",
                    (key,),
                )
                old_rows = cur.fetchall()
            if not old_rows:
                continue
            old_ids = {r[0] for r in old_rows}
            with self.new.cursor() as cur:
                cur.execute("select id::text, updated_by_name from aa_prompts where key = %s", (key,))
                current = cur.fetchall()
                already = any(pid in old_ids for pid, _ in current)
                seeded_only = all(author == SEEDED_PROMPT_AUTHOR for _, author in current)
                if not already and current and not seeded_only:
                    self.notes.append(
                        f"промпт «{key}» на портале уже правили — его история из прежней системы не перенесена"
                    )
                    skipped_total += len(old_rows)
                    continue
                if not already and current:
                    cur.execute(
                        "delete from aa_prompts where key = %s and updated_by_name = %s",
                        (key, SEEDED_PROMPT_AUTHOR),
                    )
                rows = [
                    (i, k, (n or k)[:500], d, (c or "")[:100000], m, v, bool(a), (u or "")[:200], created)
                    for i, k, n, d, c, m, v, a, u, created in old_rows
                ]
                res = execute_values(
                    cur,
                    "insert into aa_prompts (id, key, name, description, content, model, version, active, "
                    "updated_by_name, created_at) values %s on conflict do nothing returning 1",
                    rows, fetch=True,
                )
                inserted_total += len(res)
                skipped_total += len(rows) - len(res)
        self.report.append(("Промпты (версии)", inserted_total, skipped_total))

    def feedback(self) -> None:
        if "dialog_feedback" not in self.old_tables():
            return
        self.insert(
            "«Согласен / не согласен»",
            "insert into aa_feedback (id, recording_id, dialog_id, metric_id, author_name, subject_name, agree, "
            "comment, created_at) values %s",
            (
                [(i, r, d, m, (an or "")[:200], (sn or "")[:200], bool(a), (c or "")[:1000], created)
                 for i, r, d, m, an, sn, a, c, created in batch]
                for batch in self.rows(
                    "select id::text, day_recording_id::text, dialog_id::text, metric_id::text, author_name, "
                    "subject_name, agree, comment, created_at from dialog_feedback where metric_id is not null"
                )
            ),
        )

    def agreements(self) -> None:
        if "agreements" not in self.old_tables():
            return

        def convert(batch):
            out = []
            for (i, emp, emp_name, rec, day, dlg, dlg_s, txt, status, by_name, created,
                 resolved_at, resolved_by, resolved_rec, note) in batch:
                txt = (txt or "").strip()[:2000]
                if not txt:
                    continue
                out.append((
                    i, emp, emp_name or "", rec, day, dlg, dlg_s, txt,
                    status if status in AGREEMENT_STATUSES else "open", by_name or "", created,
                    resolved_at, resolved_by or "", resolved_rec, (note or "")[:2000],
                ))
            return out

        self.insert(
            "Договорённости",
            "insert into aa_agreements (id, manager_id, manager_name, recording_id, day_date, dialog_id, "
            "dialog_start_s, text, status, created_by_name, created_at, resolved_at, resolved_by_name, "
            "resolved_recording_id, resolution_note) values %s",
            (convert(b) for b in self.rows(
                "select id::text, employee_id::text, employee_name, day_recording_id::text, day_date, "
                "dialog_id::text, dialog_start_s, text, status, created_by_name, created_at, resolved_at, "
                "resolved_by_name, resolved_day_recording_id::text, resolution_note from agreements"
            )),
        )

    def releases(self) -> None:
        if "app_releases" not in self.old_tables():
            return
        self.insert(
            "Сборки приложения",
            "insert into aa_app_releases (id, platform, version, notes, archive_uri, signature, size_bytes, "
            "published, created_by_name, created_at) values %s",
            (
                [r for r in batch if r[1] in PLATFORMS]
                for batch in self.rows(
                    "select id::text, platform, version, coalesce(notes, ''), archive_uri, signature, "
                    "coalesce(size_bytes, 0), published, coalesce(created_by_name, ''), created_at "
                    "from app_releases"
                )
            ),
        )

    def run(self) -> None:
        self.locations()
        self.managers()
        self.recordings()
        self.simple()
        self.metrics()
        self.day_summaries()
        self.prompts()
        self.feedback()
        self.agreements()
        self.releases()

    # --- файлы ---------------------------------------------------------------------------

    def copy_audio(self, settings, dry_run: bool) -> None:
        if not settings.old_s3_bucket or not (settings.old_s3_endpoint_url or settings.old_s3_access_key_id):
            raise SystemExit("--copy-audio: задайте OLD_S3_ENDPOINT_URL, OLD_S3_ACCESS_KEY_ID, "
                             "OLD_S3_SECRET_ACCESS_KEY и OLD_S3_BUCKET прежнего хранилища")
        if (settings.storage_backend == "s3" and settings.s3_bucket == settings.old_s3_bucket
                and settings.s3_endpoint_url.rstrip("/") == settings.old_s3_endpoint_url.rstrip("/")):
            self.notes.append("хранилище то же, что у прежней системы, — файлы копировать не нужно")
            return
        old_s3 = storage.make_s3_client(
            settings.old_s3_endpoint_url, settings.old_s3_access_key_id,
            settings.old_s3_secret_access_key, settings.old_s3_region,
        )
        dest = storage.get_storage()
        cutoff = date.today() - timedelta(days=settings.audio_retention_days)
        with self.old.cursor() as cur:
            cur.execute("select id::text, date from day_recordings")
            recs = cur.fetchall()
            archives = []
            if "app_releases" in self.old_tables():
                cur.execute("select archive_uri from app_releases")
                archives = [r[0] for r in cur.fetchall()]

        def listed(prefix: str):
            token = None
            while True:
                kwargs = {"Bucket": settings.old_s3_bucket, "Prefix": prefix}
                if token:
                    kwargs["ContinuationToken"] = token
                page = old_s3.list_objects_v2(**kwargs)
                for item in page.get("Contents", []):
                    yield item["Key"], int(item.get("Size") or 0)
                if not page.get("IsTruncated"):
                    break
                token = page.get("NextContinuationToken")

        copied = skipped = failed = old_audio = 0
        copied_bytes = 0
        jobs: list[tuple[str, int]] = []
        for rid, day in recs:
            for key, size in listed(f"recordings/{rid}/"):
                if (settings.audio_retention_days > 0 and day < cutoff
                        and not key.endswith("transcript.json")):
                    old_audio += 1
                    continue
                jobs.append((key, size))
        for key in archives:
            jobs.extend(listed(key))
        for key, size in jobs:
            try:
                if dest.size(key) == size:
                    skipped += 1
                    continue
                if dry_run:
                    copied += 1
                    copied_bytes += size
                    continue
                obj = old_s3.get_object(Bucket=settings.old_s3_bucket, Key=key)
                dest.put_stream(key, obj["Body"], obj.get("ContentType") or storage.content_type_for(key))
                copied += 1
                copied_bytes += size
            except Exception as e:  # noqa: BLE001 — один файл не должен остановить перенос
                failed += 1
                self.out(f"  ! {key}: {e}")
        verb = "будет скопировано" if dry_run else "скопировано"
        self.notes.append(
            f"файлы: {verb} {copied} ({copied_bytes / 1024 / 1024:.1f} МБ), уже были {skipped}, "
            f"ошибок {failed}, аудио старше срока хранения не копировалось: {old_audio}"
        )

    def summary(self) -> str:
        width = max(len(label) for label, _, _ in self.report) if self.report else 10
        lines = [f"{'Таблица'.ljust(width)}  перенесено  уже было"]
        for label, inserted, skipped in self.report:
            lines.append(f"{label.ljust(width)}  {inserted:>10}  {skipped:>8}")
        if self.notes:
            lines.append("")
            lines.extend(f"• {note}" for note in self.notes)
        return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m cli.import_legacy",
        description="Перенос данных прежнего проекта audio-analitics в таблицы aa_* портала.",
    )
    parser.add_argument("--old-database-url", required=True, help="база прежнего проекта (postgres://…)")
    parser.add_argument("--database-url", help="база портала; по умолчанию DATABASE_URL")
    parser.add_argument("--copy-audio", action="store_true",
                        help="скопировать файлы из прежнего S3/R2 (OLD_S3_*) в хранилище сервиса")
    parser.add_argument("--dry-run", action="store_true",
                        help="посчитать и откатить: в базе портала ничего не останется, файлы не копируются")
    args = parser.parse_args(argv)

    settings = get_settings()
    new_url = plain_database_url(args.database_url or settings.database_url)
    old = psycopg2.connect(plain_database_url(args.old_database_url))
    old.set_session(readonly=True)
    new = psycopg2.connect(new_url)
    importer = Importer(old, new)
    try:
        importer.run()
        if args.dry_run:
            new.rollback()
        else:
            new.commit()
        if args.copy_audio:
            importer.copy_audio(settings, dry_run=args.dry_run)
    except Exception:
        new.rollback()
        raise
    finally:
        old.close()
        new.close()

    title = "Пробный перенос (--dry-run): в базе портала ничего не изменено" if args.dry_run else "Перенос завершён"
    print(title)
    print(importer.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
