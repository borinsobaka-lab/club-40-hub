"""Сервис на настоящей базе портала: приём записи, очередь, стирание, разбор, права.

Запускается, только если задан TEST_SCHEMA_DATABASE_URL — база с полной
схемой (bash db/test/build-schema.sh <url> из корня репозитория). Вся
работа идёт в одной внешней транзакции, а «commit» сервиса превращается в
точку сохранения (join_transaction_mode="create_savepoint"); в конце теста
транзакция откатывается — общая тестовая база остаётся чистой.

Сеть не нужна: распознавание речи, модель и VAD подменены, проверка входа
GoTrue — тоже. Аудио настоящее: несколько секунд синуса, закодированные
ffmpeg в Ogg Opus, как их шлёт приложение.
"""
import io
import json
import os
import plistlib
import subprocess
import tarfile
import urllib.parse
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app import auth, storage
from app import db as dbmod
from app import worker
from app.config import normalize_database_url
from app.models import (
    AaAppRelease,
    AaDaySummary,
    AaDialog,
    AaDialogTurn,
    AaLocation,
    AaManager,
    AaMetric,
    AaMetricEvaluation,
    AaRecording,
    AaSegment,
    AaStoragePurge,
    AaTranscript,
)
from app.pipeline import llm as llm_mod
from app.pipeline import tasks
from app.pipeline.asr import AsrResult, Word
from app.pipeline.cost import compute_cost

DB_URL = os.environ.get("TEST_SCHEMA_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="TEST_SCHEMA_DATABASE_URL не задан")

APP_KEY = "test-app-key"
SECRET = "integration-secret-0123456789"


# --- окружение ------------------------------------------------------------------------

@pytest.fixture
def env(tmp_path, configure):
    return configure(
        database_url=DB_URL,
        environment="development",
        app_key=APP_KEY,
        storage_backend="local",
        storage_dir=tmp_path / "data",
        files_url_secret=SECRET,
        public_url="https://audio.test",
        supabase_url="https://supabase.test",
        supabase_anon_key="anon",
        anthropic_api_key="test",
        elevenlabs_api_key="test",
        audio_retention_days=60,
        llm_min_dialog_turns=4,
    )


@pytest.fixture
def conn(env):
    engine = create_engine(normalize_database_url(DB_URL))
    connection = engine.connect()
    outer = connection.begin()
    # Чужие смены в очереди (если тестовая база не пуста) не должны попасть
    # под claim_next — в этой транзакции их просто нет в очереди.
    connection.execute(
        text("update aa_recordings set status = 'error' where status in ('queued', 'processing')")
    )
    connection.execute(text("delete from aa_storage_purge"))
    # Справочник метрик — свой на тест (стартовые метрики миграции выключены).
    connection.execute(text("update aa_metrics set active = false"))
    factory = sessionmaker(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    dbmod.set_session_factory(factory)
    try:
        yield connection
    finally:
        dbmod.set_session_factory(None)
        outer.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def db(conn):
    session = dbmod.session_factory()
    yield session
    session.close()


@pytest.fixture
def client(conn):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def make_user(conn, rights: list[str] | None, email: str | None = None) -> uuid.UUID:
    """Учётная запись портала; rights — сетевые права (как после пересчёта
    ролей), None — человек вне модели прав."""
    conn.execute(text("set local session_replication_role = replica"))
    uid = conn.execute(
        text("insert into auth.users (email) values (:e) returning id"),
        {"e": email or f"u-{uuid.uuid4()}@example.com"},
    ).scalar_one()
    conn.execute(text("set local session_replication_role = origin"))
    if rights is not None:
        conn.execute(
            text("insert into access_user_rights (user_id, rights, portal) values (:u, :r, true)"),
            {"u": uid, "r": rights},
        )
    return uid


@pytest.fixture
def tokens(monkeypatch):
    """Подмена GoTrue: токен → пользователь. Проверка Bearer и кэш — настоящие."""
    known: dict[str, auth.StaffUser] = {}
    monkeypatch.setattr(auth.verifier, "_ask_gotrue", lambda token: known.get(token))
    monkeypatch.setattr(auth.verifier, "_cache", {})
    return known


@pytest.fixture
def place(db):
    loc = AaLocation(name=f"Тест {uuid.uuid4().hex[:8]}", address="ул. Тестовая, 1")
    closed = AaLocation(name=f"Закрыта {uuid.uuid4().hex[:8]}", active=False)
    mgr = AaManager(full_name="Анна Тестова")
    gone = AaManager(full_name="Уволенный Менеджер", active=False)
    db.add_all([loc, closed, mgr, gone])
    db.commit()
    return {"loc": loc, "closed": closed, "mgr": mgr, "gone": gone}


def device_headers(location_id) -> dict:
    return {"X-App-Key": APP_KEY, "X-Location-Id": str(location_id)}


def opus_segment(tmp_path, n: int, seconds: float = 2.0) -> bytes:
    out = tmp_path / f"gen_{n}.opus"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"sine=frequency={300 + 100 * n}:duration={seconds}",
            "-c:a", "libopus", "-b:a", "32k", "-ac", "1", str(out),
        ],
        check=True,
    )
    return out.read_bytes()


# --- приложение на ресепшене -------------------------------------------------------------

def test_device_flow_start_resume_upload_finish(client, db, place, tmp_path):
    loc, mgr = place["loc"], place["mgr"]
    h = device_headers(loc.id)

    # Список точек — только по ключу приложения, закрытой там нет.
    assert client.get("/api/recordings/locations").status_code == 401
    names = [x["name"] for x in client.get("/api/recordings/locations", headers={"X-App-Key": APP_KEY}).json()]
    assert loc.name in names and place["closed"].name not in names
    picked = next(x for x in client.get("/api/recordings/locations", headers={"X-App-Key": APP_KEY}).json()
                  if x["id"] == str(loc.id))
    assert picked == {"id": str(loc.id), "name": loc.name, "address": "ул. Тестовая, 1"}

    # Менеджеры — активные, точка — устройства.
    employees = client.get("/api/recordings/employees", headers=h).json()
    me = next(e for e in employees if e["id"] == str(mgr.id))
    assert me == {"id": str(mgr.id), "location_id": str(loc.id), "full_name": "Анна Тестова",
                  "role": "manager", "active": True}
    assert str(place["gone"].id) not in {e["id"] for e in employees}
    assert client.get("/api/recordings/employees",
                      headers=device_headers(place["closed"].id)).status_code == 404
    assert client.get("/api/recordings/employees",
                      headers={"X-App-Key": APP_KEY, "X-Location-Id": "nope"}).status_code == 400
    assert client.get("/api/recordings/employees",
                      headers={"X-App-Key": "wrong", "X-Location-Id": str(loc.id)}).status_code == 401

    # Старт и возобновление после «вылета».
    today = date.today().isoformat()
    first = client.post("/api/recordings/start", json={"date": today, "employee_id": str(mgr.id)}, headers=h)
    assert first.status_code == 200, first.text
    day = first.json()
    assert day["status"] == "recording" and day["employee_id"] == str(mgr.id)
    assert day["location_name"] == loc.name and day["employee_name"] == "Анна Тестова"
    again = client.post("/api/recordings/start", json={"date": today, "employee_id": str(mgr.id)}, headers=h)
    assert again.json()["id"] == day["id"]
    assert client.post("/api/recordings/start", json={"date": today, "employee_id": str(uuid.uuid4())},
                       headers=h).status_code == 404
    rid = day["id"]

    # Сегменты: повтор того же номера перезаписывает файл и размер.
    seg0, seg1 = opus_segment(tmp_path, 0), opus_segment(tmp_path, 1)
    up = client.put(f"/api/recordings/{rid}/segments/0", headers=h,
                    files={"file": ("seg_00000.opus", b"short", "audio/ogg")})
    assert up.status_code == 200, up.text
    up2 = client.put(f"/api/recordings/{rid}/segments/0", headers=h,
                     files={"file": ("seg_00000.opus", seg0, "audio/ogg")})
    assert up2.json() == {"id": up.json()["id"], "idx": 0}
    client.put(f"/api/recordings/{rid}/segments/1", headers=h, files={"file": ("seg_00001.opus", seg1, "audio/ogg")})
    db.expire_all()
    segs = db.scalars(select(AaSegment).where(AaSegment.recording_id == uuid.UUID(rid)).order_by(AaSegment.idx)).all()
    assert [(s.idx, s.size_bytes) for s in segs] == [(0, len(seg0)), (1, len(seg1))]
    assert storage.get_bytes(storage.segment_key(rid, 0)) == seg0
    db.commit()

    # Чужая точка смены не видит; пустой файл и плохой номер — 400.
    other = AaLocation(name=f"Другая {uuid.uuid4().hex[:8]}")
    db.add(other)
    db.commit()
    assert client.put(f"/api/recordings/{rid}/segments/2", headers=device_headers(other.id),
                      files={"file": ("x.opus", seg0, "audio/ogg")}).status_code == 404
    assert client.put(f"/api/recordings/{rid}/segments/2", headers=h,
                      files={"file": ("x.opus", b"", "audio/ogg")}).status_code == 400
    assert client.put(f"/api/recordings/{rid}/segments/-1", headers=h,
                      files={"file": ("x.opus", seg0, "audio/ogg")}).status_code == 400

    # Завершение: не хватает сегментов — 409 (как раньше), хватает — «ждёт разбора».
    short = client.post(f"/api/recordings/{rid}/finish", json={"total_segments": 3}, headers=h)
    assert short.status_code == 409
    done = client.post(f"/api/recordings/{rid}/finish", json={"total_segments": 2}, headers=h)
    assert done.status_code == 200 and done.json()["status"] == "uploaded"
    assert done.json()["status_detail"] == "запись завершена, ждёт запуска разбора"
    # Повтор «завершить» — уже сделано.
    assert client.post(f"/api/recordings/{rid}/finish", json={"total_segments": 2}, headers=h).status_code == 200
    # После завершённой смены новый старт — новая смена.
    new = client.post("/api/recordings/start", json={"date": today}, headers=h).json()
    assert new["id"] != rid and new["employee_id"] is None

    # Смену разобрали: опоздавшие запросы получают 409 — приложение перестаёт дозагружать.
    db.execute(text("update aa_recordings set status = 'done' where id = :id"), {"id": rid})
    db.commit()
    assert client.put(f"/api/recordings/{rid}/segments/5", headers=h,
                      files={"file": ("x.opus", seg0, "audio/ogg")}).status_code == 409
    assert client.post(f"/api/recordings/{rid}/finish", json={"total_segments": 2}, headers=h).status_code == 409


def test_app_update_manifest_and_download(client, db):
    platform = "linux"
    db.execute(text("delete from aa_app_releases where platform = :p"), {"p": platform})
    storage.upload_bytes("app-releases/linux/0.10.0/app.tar.gz", b"ARCHIVE-0.10.0")
    db.add_all([
        AaAppRelease(platform=platform, version="0.9.0", archive_uri="app-releases/linux/0.9.0/app.tar.gz",
                     signature="sig-9"),
        AaAppRelease(platform=platform, version="0.10.0", archive_uri="app-releases/linux/0.10.0/app.tar.gz",
                     signature="sig-10", notes="Новое"),
        AaAppRelease(platform=platform, version="0.11.0", archive_uri="app-releases/linux/0.11.0/app.tar.gz",
                     signature="sig-11", published=False),
    ])
    db.commit()
    h = {"X-App-Key": APP_KEY}
    assert client.get("/api/app/update/linux/x86_64/0.10.0", headers=h).status_code == 204
    assert client.get("/api/app/update/linux/x86_64/0.10.0").status_code == 401
    assert client.get("/api/app/update/windows/x86_64/0.0.1", headers=h).status_code in (200, 204)
    resp = client.get("/api/app/update/linux/x86_64/0.9.5", headers=h)
    assert resp.status_code == 200
    manifest = resp.json()
    assert manifest["version"] == "0.10.0" and manifest["signature"] == "sig-10"
    assert manifest["notes"] == "Новое" and manifest["pub_date"]
    assert manifest["url"].startswith("https://audio.test/files/")
    download = client.get(urllib.parse.urlparse(manifest["url"]).path)
    assert download.status_code == 200 and download.content == b"ARCHIVE-0.10.0"


# --- воркер: очередь, сироты, стирание, срок хранения -------------------------------------------

def test_claim_and_orphan_reset(db, place):
    loc = place["loc"]
    old = AaRecording(location_id=loc.id, date=date.today(), status="queued", process_full=True)
    newer = AaRecording(location_id=loc.id, date=date.today(), status="queued")
    orphan = AaRecording(location_id=loc.id, date=date.today(), status="processing")
    db.add_all([old, newer, orphan])
    db.commit()
    db.execute(text("update aa_recordings set status_changed_at = now() - interval '1 hour' where id = :id"),
               {"id": old.id})
    db.commit()

    # Сирота возвращается в очередь со своим пояснением.
    assert worker.reset_orphans(db) == [orphan.id]
    db.expire_all()
    assert db.get(AaRecording, orphan.id).status == "queued"
    assert db.get(AaRecording, orphan.id).status_detail == worker.ORPHAN_DETAIL

    # Забираются по давности, с флагом «распознать заново».
    assert worker.claim_next(db) == (old.id, True)
    db.expire_all()
    rec = db.get(AaRecording, old.id)
    assert rec.status == "processing" and rec.status_detail == "подготовка аудио"
    db.commit()
    claimed = {worker.claim_next(db)[0], worker.claim_next(db)[0]}
    assert claimed == {newer.id, orphan.id}
    assert worker.claim_next(db) is None

    # Смена, которая раз за разом обрывается перезапуском, перестаёт возвращаться
    # в очередь: первый обрыв уже был выше, второй — ещё в очередь, третий — ошибка.
    for expected in ("queued", "error"):
        db.execute(text("update aa_recordings set status = 'processing' where id = :id"), {"id": orphan.id})
        db.commit()
        worker.reset_orphans(db)
        db.expire_all()
        assert db.get(AaRecording, orphan.id).status == expected
    assert "обрывался перезапуском" in db.get(AaRecording, orphan.id).status_detail
    db.commit()


def test_storage_purge_from_delete_rpc_and_release_trigger(conn, db, place):
    manager = make_user(conn, ["audio.manage"])
    rec = AaRecording(location_id=place["loc"].id, date=date.today(), status="uploaded")
    rel = AaAppRelease(platform="darwin", version="9.9.9", archive_uri="app-releases/darwin/9.9.9/app.tar.gz",
                       signature="s")
    db.add_all([rec, rel])
    db.commit()
    storage.upload_bytes(storage.segment_key(str(rec.id), 0), b"a")
    storage.upload_bytes(storage.merged_key(str(rec.id)), b"b")
    storage.upload_bytes(rel.archive_uri, b"c")
    keep = AaRecording(location_id=place["loc"].id, date=date.today(), status="uploaded")
    db.add(keep)
    db.commit()
    storage.upload_bytes(storage.segment_key(str(keep.id), 0), b"keep")

    # Админка удаляет смену (RPC) и сборку (RLS) — база ставит файлы в очередь.
    db.execute(text("select set_config('request.jwt.claim.sub', :u, true)"), {"u": str(manager)})
    db.execute(text("select public.aa_recording_delete(:id)"), {"id": rec.id})
    db.execute(text("select set_config('request.jwt.claim.sub', '', true)"))
    db.execute(text("delete from aa_app_releases where id = :id"), {"id": rel.id})
    db.add(AaStoragePurge(prefix="r"))  # подозрительный — не трогается
    db.commit()
    prefixes = set(db.scalars(select(AaStoragePurge.prefix)))
    assert prefixes == {f"recordings/{rec.id}/", "app-releases/darwin/9.9.9/app.tar.gz", "r"}

    done, failed = worker.drain_purge(db)
    assert (done, failed) == (2, 1)
    assert not storage.get_storage().exists(storage.merged_key(str(rec.id)))
    assert not storage.get_storage().exists(rel.archive_uri)
    assert storage.get_storage().exists(storage.segment_key(str(keep.id), 0))
    assert set(db.scalars(select(AaStoragePurge.prefix))) == {"r"}
    db.commit()


def test_retention_keeps_transcript_and_recent_audio(db, place):
    loc = place["loc"]
    old_day = date.today() - timedelta(days=100)
    old = AaRecording(location_id=loc.id, date=old_day, status="done")
    old_busy = AaRecording(location_id=loc.id, date=old_day, status="queued")
    recent = AaRecording(location_id=loc.id, date=date.today() - timedelta(days=5), status="done")
    db.add_all([old, old_busy, recent])
    db.commit()
    for rec in (old, old_busy, recent):
        key = storage.segment_key(str(rec.id), 0)
        storage.upload_bytes(key, b"seg")
        storage.upload_bytes(storage.merged_key(str(rec.id)), b"merged")
        storage.upload_bytes(storage.transcript_key(str(rec.id)), b"{}")
        db.add(AaSegment(recording_id=rec.id, idx=0, audio_uri=key, size_bytes=3))
        rec.raw_audio_uri = storage.merged_key(str(rec.id))
    db.commit()

    assert worker.run_retention(db, 60) == 1
    db.expire_all()
    store = storage.get_storage()
    purged = db.get(AaRecording, old.id)
    assert purged.audio_purged_at is not None and purged.raw_audio_uri is None
    assert not store.exists(storage.segment_key(str(old.id), 0))
    assert not store.exists(storage.merged_key(str(old.id)))
    assert store.exists(storage.transcript_key(str(old.id)))
    # Строки сегментов остаются — что и когда было загружено.
    assert db.scalar(select(AaSegment.id).where(AaSegment.recording_id == old.id)) is not None
    for rec in (old_busy, recent):
        assert db.get(AaRecording, rec.id).audio_purged_at is None
        assert store.exists(storage.merged_key(str(rec.id)))
    # Повторный проход ничего не трогает; 0 дней — не стирать вовсе.
    assert worker.run_retention(db, 60) == 0
    assert worker.run_retention(db, 0) == 0
    db.commit()


# --- разбор смены -------------------------------------------------------------------------

class FakeAsr:
    """Слова — по файлу одной речи (как отвечает Scribe): пайплайн сам
    переводит их таймкоды на исходную запись."""

    calls = 0

    def transcribe(self, path):
        FakeAsr.calls += 1
        spoken = [
            ("Здравствуйте, хочу записаться", 0.1, 0.5, "speaker_0"),
            ("Конечно, на какое время", 0.6, 1.0, "speaker_1"),
            ("На вечер", 1.1, 1.5, "speaker_0"),
            ("Есть место в семь", 1.6, 1.9, "speaker_1"),
            ("Беру абонемент", 2.2, 2.6, "speaker_0"),
            ("Оформляю", 2.8, 3.2, "speaker_1"),
        ]
        words = [Word(t, s, e, sp) for t, s, e, sp in spoken]
        return AsrResult(provider="elevenlabs", language="rus", text=" ".join(w[0] for w in spoken),
                         words=words, raw={"fake": True})


class FailingAsr:
    def transcribe(self, path):
        raise AssertionError("распознавание не должно вызываться при пересчёте")


class _Msg:
    def __init__(self):
        self.usage = type("U", (), {"input_tokens": 1000, "output_tokens": 200,
                                    "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0})()


class FakeLlm:
    def __init__(self):
        self.usage = llm_mod.LlmUsage()
        self.seen_metrics: list[list[str]] = []

    def segment_dialogs(self, transcript, prompt_content, model, day_duration_s=None):
        assert "{{transcript}}" in prompt_content and "speaker_0" in transcript
        self.usage.add(_Msg(), model)
        return llm_mod.normalize_dialogs(
            [
                {"start_s": 0.0, "end_s": 4.0, "type": "sale", "brief": "Запись и покупка абонемента"},
                {"start_s": "00:00:05", "end_s": 5.8, "type": "irrelevant", "brief": "личное"},
            ],
            day_duration_s,
        )

    def evaluate_metrics(self, dialog_text, metrics, model):
        self.usage.add(_Msg(), model)
        self.seen_metrics.append([m["name"] for m in metrics])
        raw = {"evaluations": [
            {"metric": 1, "applicable": True, "score": 8, "good": ["[00:00:01] спросила время"],
             "bad": ["[00:00:03] не назвала цену"], "comment": "Хорошо"},
            {"metric": 2, "applicable": False, "score": None},
        ]}
        return llm_mod.parse_metric_evals(raw, metrics)

    def summarize_day(self, analyses, stats, prompt_content, model):
        self.usage.add(_Msg(), model)
        assert stats["sales_count"] == 1 and analyses[0]["type"] == "sale"
        return {"top_deviations": ["цена"], "recommendations": ["называть цену"],
                "script_suggestions": [], "highlights": ["записала"]}


@pytest.fixture
def fakes(monkeypatch):
    holder = {}

    def make_llm():
        holder["llm"] = FakeLlm()
        return holder["llm"]

    FakeAsr.calls = 0
    monkeypatch.setattr(tasks, "LlmClient", make_llm)
    monkeypatch.setattr(tasks, "get_asr", lambda: FakeAsr())
    # Silero качается с GitHub — в тесте речь «находится» в двух местах.
    monkeypatch.setattr(tasks, "find_speech_regions", lambda *a, **k: [(0.5, 2.5), (3.0, 5.0)])
    return holder


def recorded_shift(client, db, place, tmp_path) -> uuid.UUID:
    """Смена из трёх двухсекундных сегментов, загруженная через API приложения
    и поставленная в очередь (как это делает aa_recording_process)."""
    h = device_headers(place["loc"].id)
    rid = client.post("/api/recordings/start", json={"date": date.today().isoformat(),
                                                      "employee_id": str(place["mgr"].id)}, headers=h).json()["id"]
    for i in range(3):
        resp = client.put(f"/api/recordings/{rid}/segments/{i}", headers=h,
                          files={"file": (f"seg_{i:05d}.opus", opus_segment(tmp_path, i), "audio/ogg")})
        assert resp.status_code == 200
    assert client.post(f"/api/recordings/{rid}/finish", json={"total_segments": 3}, headers=h).status_code == 200
    db.execute(text("update aa_recordings set status = 'queued', process_full = false where id = :id"), {"id": rid})
    db.commit()
    return uuid.UUID(rid)


def add_metrics(db):
    m1 = AaMetric(name="Качество продажи", prompt="Оцени продажу", scale_max=10, position=1)
    m2 = AaMetric(name="Встреча", prompt="Оцени встречу", scale_max=5, position=2)
    db.add_all([m1, m2])
    db.commit()
    return m1, m2


def test_pipeline_full_run_and_recalculation(client, conn, db, place, tmp_path, fakes, monkeypatch, env, tokens):
    m1, m2 = add_metrics(db)
    rid = recorded_shift(client, db, place, tmp_path)

    claimed = worker.claim_next(db)
    assert claimed == (rid, False)
    result = worker.run_claimed(db, rid, False)
    assert result.startswith("диалогов: 2"), result

    db.expire_all()
    rec = db.get(AaRecording, rid)
    assert rec.status == "done", rec.status_detail
    assert "метрик: 2" in rec.status_detail and "сработало оценок: 1 из 2" in rec.status_detail
    assert rec.raw_audio_uri == storage.merged_key(str(rid))
    assert rec.total_duration_s == pytest.approx(6.0, abs=0.2)
    assert rec.speech_duration_s == pytest.approx(4.0, abs=0.01)
    assert rec.asr_seconds == pytest.approx(4.0, abs=0.01)
    assert rec.llm_calls == 3 and rec.llm_input_tokens == 3000 and rec.llm_output_tokens == 600
    expected = compute_cost(rec.asr_seconds, fakes["llm"].usage.cost_usd, env.price_asr_per_hour_usd)
    assert rec.cost_usd == pytest.approx(expected.total_usd) and rec.cost_usd > 0
    assert fakes["llm"].seen_metrics == [["Качество продажи", "Встреча"]]

    store = storage.get_storage()
    assert store.exists(storage.merged_key(str(rid)))
    saved = json.loads(store.get_bytes(storage.transcript_key(str(rid))))
    assert saved["format"] == tasks.TRANSCRIPT_FORMAT
    # Таймкоды слов — по исходной записи: 0.1 с речи → 0.6 с дня, 2.2 → 3.2.
    assert saved["words"][0]["start"] == pytest.approx(0.6, abs=0.01)
    assert saved["words"][4]["start"] == pytest.approx(3.2, abs=0.01)
    tr = db.scalars(select(AaTranscript).where(AaTranscript.recording_id == rid)).all()
    assert len(tr) == 1 and "[00:00:00] speaker_0: Здравствуйте" in tr[0].text

    dialogs = db.scalars(select(AaDialog).where(AaDialog.recording_id == rid).order_by(AaDialog.start_s)).all()
    assert [(d.type, d.outcome) for d in dialogs] == [("sale", "sale"), ("irrelevant", None)]
    assert dialogs[0].brief == "Запись и покупка абонемента" and dialogs[1].brief == ""
    turns = db.scalars(select(AaDialogTurn).where(AaDialogTurn.dialog_id == dialogs[0].id)).all()
    assert len(turns) == 6
    assert db.scalar(select(AaDialogTurn.id).where(AaDialogTurn.dialog_id == dialogs[1].id)) is None
    evals = {e.metric_id: e for e in db.scalars(
        select(AaMetricEvaluation).where(AaMetricEvaluation.recording_id == rid))}
    assert evals[m1.id].applicable and evals[m1.id].score == 8
    assert evals[m1.id].good == ["[00:00:01] спросила время"] and evals[m1.id].bad == ["[00:00:03] не назвала цену"]
    assert not evals[m2.id].applicable and evals[m2.id].score is None
    summary = db.get(AaDaySummary, rid)
    assert (summary.dialogs_total, summary.sales_count, summary.conversion) == (1, 1, 1.0)
    assert summary.summary["recommendations"] == ["называть цену"]
    db.commit()

    # Список смен админки (RPC aa_days) видит оценки.
    viewer = make_user(conn, ["audio.view"])
    db.execute(text("select set_config('request.jwt.claim.sub', :u, true)"), {"u": str(viewer)})
    days = db.scalar(text("select public.aa_days(array[:loc]::uuid[], 10)"), {"loc": place["loc"].id})
    db.execute(text("select set_config('request.jwt.claim.sub', '', true)"))
    db.commit()
    day = next(d for d in days if d["id"] == str(rid))
    assert day["dialogs_total"] == 1 and day["segments"] == 3
    assert {s["name"]: s["triggered"] for s in day["metric_stats"]} == {"Качество продажи": 1, "Встреча": 0}

    # Пересчёт по новым метрикам: расшифровка с прошлого раза, распознавание не вызывается.
    monkeypatch.setattr(tasks, "get_asr", lambda: FailingAsr())
    db.execute(text("update aa_recordings set status = 'queued', process_full = false where id = :id"), {"id": rid})
    db.commit()
    assert worker.claim_next(db) == (rid, False)
    result = worker.run_claimed(db, rid, False)
    assert "расшифровка взята с прошлого разбора" in result
    db.expire_all()
    rec = db.get(AaRecording, rid)
    assert rec.status == "done" and rec.asr_seconds == 0.0
    assert len(db.scalars(select(AaDialog).where(AaDialog.recording_id == rid)).all()) == 2
    assert len(db.scalars(select(AaTranscript).where(AaTranscript.recording_id == rid)).all()) == 1
    db.commit()

    # Плеер админки: ссылка на запись дня — тем, кому смена видна; перемотка работает.
    own_mgr_user = make_user(conn, ["audio.own"])
    stranger_own = make_user(conn, ["audio.own"])
    nobody = make_user(conn, [])
    db.execute(text("update aa_managers set user_id = :u where id = :m"), {"u": own_mgr_user, "m": place["mgr"].id})
    db.commit()
    for token, uid in (("viewer", viewer), ("own", own_mgr_user), ("stranger", stranger_own), ("nobody", nobody)):
        tokens[token] = auth.StaffUser(id=uid, email=f"{token}@example.com")

    def audio(token):
        return client.get(f"/api/staff/audio/{rid}", headers={"Authorization": f"Bearer {token}"})

    assert client.get(f"/api/staff/audio/{rid}").status_code == 401
    assert audio("unknown-token").status_code == 401
    assert audio("stranger").status_code == 404
    assert audio("nobody").status_code == 404
    assert client.get(f"/api/staff/audio/{uuid.uuid4()}", headers={"Authorization": "Bearer viewer"}).status_code == 404
    for token in ("viewer", "own"):
        resp = audio(token)
        assert resp.status_code == 200, resp.text
        assert resp.json()["expires_in_s"] == env.presigned_url_ttl_s
    url = audio("viewer").json()["url"]
    merged = store.get_bytes(storage.merged_key(str(rid)))
    part = client.get(urllib.parse.urlparse(url).path, headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == merged[100:200]

    # Срок хранения прошёл: аудио стёрто, плеер получает 410, пересчёт — работает,
    # а «распознать заново» отказывает и не трогает готовый отчёт.
    db.execute(text("update aa_recordings set date = date - 100 where id = :id"), {"id": rid})
    db.commit()
    assert worker.run_retention(db, 60) == 1
    db.commit()
    gone = audio("viewer")
    assert gone.status_code == 410 and "стёрто" in gone.json()["detail"]

    db.execute(text("update aa_recordings set status = 'queued', process_full = true where id = :id"), {"id": rid})
    db.commit()
    worker.run_claimed(db, *worker.claim_next(db))
    db.expire_all()
    rec = db.get(AaRecording, rid)
    assert rec.status == "error" and "стёрто по сроку хранения" in rec.status_detail
    assert len(db.scalars(select(AaDialog).where(AaDialog.recording_id == rid)).all()) == 2
    db.commit()

    db.execute(text("update aa_recordings set status = 'queued', process_full = false where id = :id"), {"id": rid})
    db.commit()
    worker.run_claimed(db, *worker.claim_next(db))
    db.expire_all()
    rec = db.get(AaRecording, rid)
    assert rec.status == "done", rec.status_detail
    assert "расшифровка взята с прошлого разбора" in rec.status_detail
    db.commit()


@pytest.mark.skipif(
    not os.path.isfile(os.environ.get("VAD_MODEL_PATH", "/nonexistent")),
    reason="модель Silero не скачана (VAD_MODEL_PATH)",
)
def test_pipeline_with_real_vad_on_tone_finds_no_speech(client, db, place, tmp_path, fakes, monkeypatch):
    """Настоящие ffmpeg и Silero VAD: синус — не речь. Смена закрывается
    понятным пояснением, распознавание не вызывается и не оплачивается."""
    from app.pipeline import vad

    monkeypatch.setattr(tasks, "find_speech_regions", vad.find_speech_regions)
    rid = recorded_shift(client, db, place, tmp_path)
    worker.run_claimed(db, *worker.claim_next(db))
    db.expire_all()
    rec = db.get(AaRecording, rid)
    assert rec.status == "done", rec.status_detail
    assert rec.status_detail.startswith("речь в записи не найдена")
    assert FakeAsr.calls == 0 and rec.asr_seconds == 0.0 and rec.cost_usd == 0.0
    assert rec.total_duration_s == pytest.approx(6.0, abs=0.2)
    assert db.get(AaDaySummary, rid).dialogs_total == 0
    db.commit()


def test_pipeline_error_is_shown_in_status(client, db, place, tmp_path, fakes, monkeypatch):
    class BrokenAsr:
        def transcribe(self, path):
            raise RuntimeError("ElevenLabs Scribe ответил 500: сломалось")

    monkeypatch.setattr(tasks, "get_asr", lambda: BrokenAsr())
    rid = recorded_shift(client, db, place, tmp_path)
    worker.run_claimed(db, *worker.claim_next(db))
    db.expire_all()
    rec = db.get(AaRecording, rid)
    assert rec.status == "error"
    assert rec.status_detail.startswith("ElevenLabs Scribe ответил 500: сломалось")
    assert "Traceback" in rec.status_detail
    db.commit()


def test_recording_deleted_during_processing(db, place, monkeypatch):
    rec = AaRecording(location_id=place["loc"].id, date=date.today(), status="queued")
    db.add(rec)
    db.commit()
    rid = rec.id

    def pipeline_that_loses_its_recording(session, r, tmp, full=False):
        storage.upload_bytes(storage.merged_key(str(r.id)), b"written after deletion")
        # Админка удалила «зависшую» смену, пока она разбиралась.
        session.execute(text("delete from aa_recordings where id = :id"), {"id": r.id})
        session.commit()
        tasks._progress(session, r, "оценка разговоров по метрикам: 1 из 3")
        return "unreachable"

    monkeypatch.setattr(tasks, "_run_pipeline", pipeline_that_loses_its_recording)
    assert worker.claim_next(db) == (rid, False)
    assert worker.run_claimed(db, rid, False) == "deleted"
    assert not storage.get_storage().exists(storage.merged_key(str(rid)))
    # Воркер жив и берёт следующую смену как обычно.
    assert worker.claim_next(db) is None
    db.commit()


def test_heartbeat_and_staff_status(conn, client, db, tokens):
    worker.write_heartbeat(db, {"pid": 42, "current_recording_id": None, "version": "test"})
    manage = make_user(conn, ["audio.manage"])
    viewer = make_user(conn, ["audio.view"])
    tokens["m"] = auth.StaffUser(id=manage, email="m@example.com")
    tokens["v"] = auth.StaffUser(id=viewer, email="v@example.com")
    assert client.get("/api/staff/status", headers={"Authorization": "Bearer v"}).status_code == 403
    resp = client.get("/api/staff/status", headers={"Authorization": "Bearer m"})
    assert resp.status_code == 200, resp.text
    status = resp.json()
    assert status["worker"]["pid"] == 42 and status["worker"]["alive"] is True
    assert status["storage_backend"] == "local" and status["app_key_set"] is True
    assert status["asr_configured"] and status["llm_configured"]
    assert set(status["queue"]) == {"queued", "processing", "stale"}


def make_archive(version: str) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = plistlib.dumps({"CFBundleShortVersionString": version})
        info = tarfile.TarInfo("Audio Recorder.app/Contents/Info.plist")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_release_upload(conn, client, db, tokens):
    db.execute(text("delete from aa_app_releases where platform = 'darwin'"))
    db.commit()
    manage = make_user(conn, ["audio.manage"], email="boss@example.com")
    viewer = make_user(conn, ["audio.view"])
    tokens["m"] = auth.StaffUser(id=manage, email="boss@example.com")
    tokens["v"] = auth.StaffUser(id=viewer, email="v@example.com")
    archive = make_archive("0.7.0")

    def upload(token, **form):
        return client.post(
            "/api/staff/releases",
            headers={"Authorization": f"Bearer {token}"},
            data={"platform": "darwin", "notes": " Исправлен микрофон ", **form},
            files={"archive": ("Audio Recorder.app.tar.gz", archive, "application/gzip"),
                   "signature_file": ("app.tar.gz.sig", b"SIGNATURE\n", "text/plain")},
        )

    assert upload("v").status_code == 403
    resp = upload("m")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version"] == "0.7.0" and body["size_bytes"] == len(archive)
    assert body["created_by_name"] == "boss@example.com" and body["notes"] == "Исправлен микрофон"
    row = db.scalar(select(AaAppRelease).where(AaAppRelease.platform == "darwin"))
    assert row.signature == "SIGNATURE" and row.archive_uri == "app-releases/darwin/0.7.0/app.tar.gz"
    assert storage.get_bytes(row.archive_uri) == archive
    dup = upload("m")
    assert dup.status_code == 409 and "уже выложена" in dup.json()["detail"]
    bad = client.post(
        "/api/staff/releases", headers={"Authorization": "Bearer m"},
        data={"platform": "beos"}, files={"archive": ("a.tar.gz", archive, "application/gzip")},
    )
    assert bad.status_code == 400
    db.commit()


def test_worker_lock_allows_one_worker_at_a_time(env):
    """Передеплой: новый воркер ждёт, пока старый отпустит замок."""
    engine = create_engine(normalize_database_url(DB_URL))
    old, new = worker.WorkerLock(engine), worker.WorkerLock(engine)
    try:
        assert old.try_acquire() and old.held()
        assert not new.try_acquire() and not new.held()
        old.release()  # старый контейнер погашен — соединение закрыто
        assert not old.held()
        assert new.try_acquire() and new.held()
    finally:
        old.release()
        new.release()
        engine.dispose()
