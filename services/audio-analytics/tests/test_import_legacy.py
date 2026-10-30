"""Перенос из прежнего проекта на настоящих базах.

Нужны две базы: TEST_SCHEMA_DATABASE_URL — портал с полной схемой, и
TEST_LEGACY_DATABASE_URL — пустая схема прежнего проекта (его миграции
backend/migrations/001–009). Данные прежней базы заводятся в незакрытой
транзакции, перенос пишет в незакрытую транзакцию портала — обе в конце
откатываются, базы остаются пустыми.
"""
import io
import os
import uuid
from datetime import date, timedelta

import psycopg2
import pytest
from psycopg2.extras import Json

from app import storage
from app.config import plain_database_url
from cli import import_legacy

NEW_URL = os.environ.get("TEST_SCHEMA_DATABASE_URL")
OLD_URL = os.environ.get("TEST_LEGACY_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not (NEW_URL and OLD_URL), reason="TEST_SCHEMA_DATABASE_URL / TEST_LEGACY_DATABASE_URL не заданы"
)


@pytest.fixture
def dbs():
    old = psycopg2.connect(plain_database_url(OLD_URL))
    new = psycopg2.connect(plain_database_url(NEW_URL))
    try:
        yield old, new
    finally:
        old.rollback()
        new.rollback()
        old.close()
        new.close()


def q(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        try:
            return cur.fetchall()
        except psycopg2.ProgrammingError:
            return None


def seed_old(old) -> dict:
    ids = {k: str(uuid.uuid4()) for k in (
        "org", "vake", "saburtalo", "emp", "rec_done", "rec_queued", "rec_old", "seg", "tr", "dlg", "turn",
        "metric", "eval", "md", "p1", "p2", "fb", "fb_overall", "agr", "rel")}
    i = ids
    q(old, "insert into organizations (id, name) values (%s, 'Lady Stretch')", (i["org"],))
    q(old, "insert into locations (id, org_id, name, address) values (%s, %s, 'Ваке', 'пр. Чавчавадзе'),"
           " (%s, %s, 'Сабуртало', '')", (i["vake"], i["org"], i["saburtalo"], i["org"]))
    q(old, "insert into employees (id, org_id, location_id, full_name) values (%s, %s, %s, 'Нино')",
      (i["emp"], i["org"], i["vake"]))
    today = date.today()
    q(old, "insert into day_recordings (id, org_id, location_id, employee_id, date, status, status_detail,"
           " raw_audio_uri, total_duration_s, cost_usd) values"
           " (%s, %s, %s, %s, %s, 'done', 'диалогов: 1', %s, 3600, 0.12),"
           " (%s, %s, %s, %s, %s, 'queued', '', null, null, null),"
           " (%s, %s, %s, %s, %s, 'done', '', null, null, null)",
      (i["rec_done"], i["org"], i["vake"], i["emp"], today, f"recordings/{i['rec_done']}/merged.opus",
       i["rec_queued"], i["org"], i["saburtalo"], i["emp"], today,
       i["rec_old"], i["org"], i["saburtalo"], None, today - timedelta(days=200)))
    q(old, "insert into segments (id, day_recording_id, idx, audio_uri) values (%s, %s, 0, %s)",
      (i["seg"], i["rec_done"], f"recordings/{i['rec_done']}/seg_00000.opus"))
    q(old, "insert into transcripts (id, day_recording_id, raw_json_uri, text) values (%s, %s, %s, 'текст')",
      (i["tr"], i["rec_done"], f"recordings/{i['rec_done']}/transcript.json"))
    q(old, "insert into dialogs (id, org_id, day_recording_id, start_s, end_s, type, outcome, brief)"
           " values (%s, %s, %s, 10, 70, 'sale', 'sale', 'Купила абонемент')",
      (i["dlg"], i["org"], i["rec_done"]))
    q(old, "insert into dialog_turns (id, dialog_id, speaker_label, start_s, end_s, text)"
           " values (%s, %s, 'speaker_0', 10, 12, 'Здравствуйте')", (i["turn"], i["dlg"]))
    q(old, "insert into analysis_metrics (id, org_id, name, prompt, scale_max, position)"
           " values (%s, %s, 'Продажа', 'Оцени продажу', 10, 1)", (i["metric"], i["org"]))
    q(old, "insert into metric_evaluations (id, day_recording_id, dialog_id, metric_id, applicable, score,"
           " good_json, bad_json, comment) values (%s, %s, %s, %s, true, 7, %s, %s, 'ок')",
      (i["eval"], i["rec_done"], i["dlg"], i["metric"], Json(["хорошо"]), Json(["плохо"])))
    q(old, "insert into metrics_daily (id, day_recording_id, org_id, location_id, date, dialogs_total,"
           " sales_count, conversion, summary_json) values (%s, %s, %s, %s, %s, 1, 1, 1.0, %s)",
      (i["md"], i["rec_done"], i["org"], i["vake"], today, Json({"recommendations": ["x"]})))
    q(old, "insert into prompt_templates (id, org_id, key, name, content, version, active, updated_by) values"
           " (%s, %s, 'dialog_segmentation', 'Сегментация', 'старый v1 {{transcript}}', 1, false, 'Владелец'),"
           " (%s, %s, 'dialog_segmentation', 'Сегментация', 'старый v2 {{transcript}}', 2, true, 'Владелец'),"
           " (gen_random_uuid(), %s, 'sale_analysis', 'Скрипт', 'не переносится', 1, true, null)",
      (i["p1"], i["org"], i["p2"], i["org"], i["org"]))
    q(old, "insert into dialog_feedback (id, org_id, day_recording_id, dialog_id, metric_id, author_key,"
           " author_name, subject_name, agree, comment) values"
           " (%s, %s, %s, %s, %s, 'owner', 'Владелец', 'Нино', false, 'не согласна')",
      (i["fb"], i["org"], i["rec_done"], i["dlg"], i["metric"]))
    q(old, "insert into agreements (id, org_id, employee_id, employee_name, day_recording_id, day_date,"
           " dialog_id, dialog_start_s, text, created_by_name) values"
           " (%s, %s, %s, 'Нино', %s, %s, %s, 10, 'Называть цену после занятия', 'Владелец')",
      (i["agr"], i["org"], i["emp"], i["rec_done"], today, i["dlg"]))
    q(old, "insert into app_releases (id, org_id, platform, version, archive_uri, signature, size_bytes)"
           " values (%s, %s, 'darwin', '0.4.0', 'app-releases/darwin/0.4.0/app.tar.gz', 'sig', 100)",
      (i["rel"], i["org"]))
    return ids


def test_import_maps_everything_and_is_idempotent(dbs):
    old, new = dbs
    ids = seed_old(old)
    # На портале уже завели «Ваке» — смены прежнего «Ваке» должны достаться ей.
    portal_vake = q(new, "insert into aa_locations (name) values ('ваке ') returning id::text")[0][0]
    seeded_metrics = q(new, "select count(*) from aa_metrics")[0][0]
    assert seeded_metrics >= 1  # стартовый набор миграции
    q(new, "delete from aa_metric_evaluations")

    first = import_legacy.Importer(old, new, out=lambda *_: None)
    first.run()
    report = {label: (ins, skip) for label, ins, skip in first.report}
    assert report["Смены"] == (3, 0)
    assert report["Реплики"] == (1, 0)
    assert report["«Согласен / не согласен»"] == (1, 0)
    assert report["Промпты (версии)"] == (2, 0)

    # Точки: «Ваке» сопоставлена по названию, «Сабуртало» перенесена со своим id.
    rec = q(new, "select location_id::text, manager_id::text, status, status_detail from aa_recordings where id = %s",
            (ids["rec_done"],))[0]
    assert rec[0] == portal_vake and rec[1] == ids["emp"] and rec[2] == "done"
    assert q(new, "select count(*) from aa_locations where id = %s", (ids["saburtalo"],))[0][0] == 1
    assert q(new, "select count(*) from aa_locations where id = %s", (ids["vake"],))[0][0] == 0
    # Незаконченный разбор прежней системы не уходит в очередь портала.
    queued = q(new, "select status, status_detail from aa_recordings where id = %s", (ids["rec_queued"],))[0]
    assert queued[0] == "uploaded" and "запустите разбор" in queued[1]
    # Метрики: стартовые заменены прежними; оценки и итоги на месте.
    assert q(new, "select array_agg(id::text) from aa_metrics")[0][0] == [ids["metric"]]
    ev = q(new, "select applicable, score, good, bad from aa_metric_evaluations where id = %s", (ids["eval"],))[0]
    assert ev == (True, 7, ["хорошо"], ["плохо"])
    assert q(new, "select summary from aa_day_summaries where recording_id = %s",
             (ids["rec_done"],))[0][0] == {"recommendations": ["x"]}
    # Промпты: стартовая версия сегментации заменена историей; итог дня — стартовый.
    seg = q(new, "select version, active, content, updated_by_name from aa_prompts"
                 " where key = 'dialog_segmentation' order by version")
    assert [(v, a) for v, a, _, _ in seg] == [(1, False), (2, True)]
    assert seg[1][2].startswith("старый v2") and seg[1][3] == "Владелец"
    assert q(new, "select updated_by_name from aa_prompts where key = 'daily_summary'")[0][0] == "Стартовый набор"
    assert q(new, "select count(*) from aa_prompts where key not in ('dialog_segmentation', 'daily_summary')")[0][0] == 0
    # Голоса и договорённости — без учётных записей, с подписями.
    fb = q(new, "select author_id, author_name, agree from aa_feedback where id = %s", (ids["fb"],))[0]
    assert fb == (None, "Владелец", False)
    agr = q(new, "select manager_id::text, created_by, created_by_name, status from aa_agreements where id = %s",
            (ids["agr"],))[0]
    assert agr == (ids["emp"], None, "Владелец", "open")
    assert q(new, "select archive_uri from aa_app_releases where id = %s",
             (ids["rel"],))[0][0] == "app-releases/darwin/0.4.0/app.tar.gz"

    # Повторный запуск ничего не дублирует и ничего не стирает.
    second = import_legacy.Importer(old, new, out=lambda *_: None)
    second.run()
    assert all(ins == 0 for _, ins, _ in second.report), second.report
    assert q(new, "select count(*) from aa_metrics")[0][0] == 1
    assert "перенесено" in second.summary()


class FakeOldS3:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        items = [{"Key": k, "Size": len(v)} for k, v in sorted(self.objects.items()) if k.startswith(Prefix)]
        return {"Contents": items, "IsTruncated": False}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key]), "ContentType": "audio/ogg"}


def test_copy_audio_skips_expired_audio_and_existing_files(dbs, tmp_path, configure, monkeypatch):
    old, new = dbs
    ids = seed_old(old)
    settings = configure(storage_backend="local", storage_dir=tmp_path, old_s3_endpoint_url="https://old.example",
                         old_s3_access_key_id="k", old_s3_bucket="old", audio_retention_days=60)
    fresh, ancient = ids["rec_done"], ids["rec_old"]
    objects = {
        f"recordings/{fresh}/seg_00000.opus": b"seg",
        f"recordings/{fresh}/merged.opus": b"merged",
        f"recordings/{fresh}/transcript.json": b"{}",
        f"recordings/{ancient}/seg_00000.opus": b"old-seg",
        f"recordings/{ancient}/transcript.json": b"{\"old\": 1}",
        "app-releases/darwin/0.4.0/app.tar.gz": b"archive",
    }
    monkeypatch.setattr(storage, "make_s3_client", lambda *a, **k: FakeOldS3(objects))
    storage.get_storage().put_bytes(f"recordings/{fresh}/merged.opus", b"merged")  # уже скопирован

    importer = import_legacy.Importer(old, new, out=lambda *_: None)
    importer.copy_audio(settings, dry_run=False)
    dest = storage.get_storage()
    assert dest.get_bytes(f"recordings/{fresh}/seg_00000.opus") == b"seg"
    assert dest.get_bytes(f"recordings/{ancient}/transcript.json") == b"{\"old\": 1}"
    assert not dest.exists(f"recordings/{ancient}/seg_00000.opus")
    assert dest.get_bytes("app-releases/darwin/0.4.0/app.tar.gz") == b"archive"
    note = importer.notes[-1]
    assert "скопировано 4" in note and "уже были 1" in note and "не копировалось: 1" in note
