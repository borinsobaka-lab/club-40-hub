"""Воркер разбора: очередь в Postgres вместо Redis и Celery.

Очередь — сама таблица смен. Админка ставит смену в очередь RPC
aa_recording_process (status = 'queued', process_full), воркер забирает
самую давнюю запросом с `for update skip locked` и разбирает её. Отдельный
брокер для одной-двух смен в день был бы лишней деталью, которая падает:
теперь всё состояние — в базе, его видно админке, и перезапуск ничего не
теряет.

Кроме разбора воркер:
  * пишет сигнал жизни в aa_service_state ('worker') раз в ~30 с — даже
    посреди многочасового разбора (отдельным потоком). По нему «Настройки»
    админки видят, работает ли разбор на сервере;
  * возвращает в очередь смены, брошенные в «processing» перезапуском
    (передеплой, падение по памяти): воркер один, значит всё, что было «в
    работе» к его старту, — сироты. «Один» обеспечивает замок в базе
    (advisory lock): при передеплое Coolify сначала поднимает новый
    контейнер и только потом гасит старый, и новый воркер ждёт, пока старый
    отпустит замок, — иначе он вернул бы в очередь смену, которую старый ещё
    разбирает, и её разобрали бы дважды (дважды заплатив);
  * стирает файлы из очереди aa_storage_purge (удалённые смены и сборки);
  * раз в сутки стирает аудио старше AUDIO_RETENTION_DAYS (политика
    хранения): сегменты и склеенную запись. Расшифровка (transcript.json)
    остаётся — по ней пересчитывают смену по новым метрикам. Строки
    aa_segments тоже остаются: они документируют, что и когда было загружено
    (число и размер кусков), а файла за ними больше нет — это видно по
    aa_recordings.audio_purged_at.

Запуск: python -m app.worker (в контейнере — рядом с API, start.sh).
"""
import logging
import os
import re
import signal
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from . import db as dbmod
from . import storage
from .config import get_settings
from .models import AaRecording, AaSegment, AaServiceState, AaStoragePurge
from .pipeline import tasks
from .version import SERVICE_VERSION

logger = logging.getLogger("worker")

ORPHAN_DETAIL = "разбор прерван перезапуском сервиса — запущен заново"
# Столько раз подряд смена возвращается в очередь после обрыва перезапуском;
# следующий обрыв — «Ошибка», в очередь она больше не возвращается: скорее всего, она сама и роняет воркер (память на
# очень длинном дне). Без предела такая смена крутилась бы вечно — и каждый
# раз платила бы за распознавание.
MAX_ORPHAN_RESTARTS = 2
ORPHAN_GIVE_UP_DETAIL = (
    "разбор {n} раза подряд обрывался перезапуском сервиса (возможно, не хватает "
    "памяти на такую длинную смену) — автоматически больше не запускается; "
    "проверьте сервер и запустите разбор вручную"
)

# Что можно стирать из очереди aa_storage_purge. Строки туда пишет только
# база (удаление смены, триггер удаления сборки), но стирание по префиксу
# необратимо: короткий или чужой префикс в S3 снёс бы всё, что с него
# начинается. Поэтому — только папка смены или папка/архив сборки.
_PURGE_RE = re.compile(
    r"^(recordings/[0-9a-fA-F-]{36}/"
    r"|app-releases/(darwin|windows|linux)/[A-Za-z0-9._+-]+/(app\.tar\.gz)?)$"
)


def safe_purge_prefix(prefix: str) -> bool:
    return bool(_PURGE_RE.match(prefix or "")) and ".." not in prefix


# --- Очередь -------------------------------------------------------------------

def claim_next(db: Session) -> tuple[uuid.UUID, bool] | None:
    """Забрать самую давнюю смену из очереди: (id, разбирать полностью).

    skip locked — чтобы два воркера (например, старый и новый контейнер на
    время передеплоя) не взяли одну и ту же смену."""
    row = db.execute(
        text(
            """
            update aa_recordings
               set status = 'processing', status_detail = 'подготовка аудио',
                   status_changed_at = now()
             where id = (select id from aa_recordings
                          where status = 'queued'
                          order by status_changed_at
                          limit 1
                          for update skip locked)
            returning id, process_full
            """
        )
    ).first()
    db.commit()
    if row is None:
        return None
    return row[0], bool(row[1])


def _get_state(db: Session, key: str) -> dict:
    value = db.scalar(select(AaServiceState.value).where(AaServiceState.key == key))
    return dict(value or {})


def _set_state(db: Session, key: str, value: dict) -> None:
    stmt = pg_insert(AaServiceState).values(key=key, value=value, updated_at=datetime.now(timezone.utc))
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[AaServiceState.key],
            set_={"value": stmt.excluded.value, "updated_at": stmt.excluded.updated_at},
        )
    )


def reset_orphans(db: Session) -> list[uuid.UUID]:
    """Смены, оставшиеся «в обработке» от прошлого запуска, — снова в очередь.

    Вызывается один раз при старте, до первого claim_next: воркер один,
    поэтому всё, что сейчас «processing», никто не разбирает."""
    rows = db.execute(
        select(AaRecording).where(AaRecording.status == "processing").with_for_update()
    ).scalars().all()
    if not rows:
        db.commit()
        return []
    counts = _get_state(db, "orphans")
    requeued: list[uuid.UUID] = []
    for rec in rows:
        n = int(counts.get(str(rec.id), 0)) + 1
        if n > MAX_ORPHAN_RESTARTS:
            rec.set_status("error", ORPHAN_GIVE_UP_DETAIL.format(n=n))
            counts.pop(str(rec.id), None)
            logger.error("recording %s: gave up after %d interrupted runs", rec.id, n)
            continue
        counts[str(rec.id)] = n
        rec.set_status("queued", ORPHAN_DETAIL)
        requeued.append(rec.id)
        logger.warning("recording %s was left in processing — queued again (%d)", rec.id, n)
    _set_state(db, "orphans", counts)
    db.commit()
    return requeued


def forget_orphan(db: Session, recording_id: uuid.UUID) -> None:
    """Разбор дошёл до конца (готово или ошибка) — счётчик обрывов сброшен."""
    db.execute(
        text("update aa_service_state set value = value - :id where key = 'orphans'"),
        {"id": str(recording_id)},
    )
    db.commit()


def run_claimed(db: Session, recording_id: uuid.UUID, full: bool) -> str:
    """Разобрать взятую смену; удалённую по ходу — убрать за ней файлы."""
    started = time.monotonic()
    logger.info("recording %s: processing (full=%s)", recording_id, full)
    try:
        result = tasks.process_recording(db, recording_id, full=full)
    except tasks.RecordingGone:
        # Смену удалили из админки, пока она разбиралась (это возможно только
        # у «зависшей»). Её строки уже стёрты, а файлы, которые разбор успел
        # записать после удаления (склейка, расшифровка), — нет: убираем сами.
        logger.warning("recording %s was deleted during processing — skipped", recording_id)
        db.rollback()
        try:
            storage.delete_prefix(storage.recording_prefix(str(recording_id)))
        except Exception:  # noqa: BLE001
            logger.exception("cleanup of deleted recording %s failed", recording_id)
        result = "deleted"
    try:
        forget_orphan(db, recording_id)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("orphan counter reset failed")
    logger.info(
        "recording %s: %s (%.0f s)", recording_id, result.splitlines()[0][:300],
        time.monotonic() - started,
    )
    return result


# --- Стирание файлов -------------------------------------------------------------

def drain_purge(db: Session, limit: int = 100, _warned: set | None = None) -> tuple[int, int]:
    """Разобрать очередь стирания: (стёрто префиксов, ошибок).

    Строка удаляется только после успешного стирания: упало хранилище —
    попробуем в следующий проход, место не потеряется молча."""
    done = failed = 0
    rows = db.execute(
        select(AaStoragePurge).order_by(AaStoragePurge.id).limit(limit).with_for_update(skip_locked=True)
    ).scalars().all()
    for row in rows:
        if not safe_purge_prefix(row.prefix):
            failed += 1
            if _warned is None or row.id not in _warned:
                logger.error("purge %s: refused suspicious prefix %r", row.id, row.prefix)
                if _warned is not None:
                    _warned.add(row.id)
            continue
        try:
            removed = storage.delete_prefix(row.prefix)
        except Exception:  # noqa: BLE001
            failed += 1
            logger.exception("purge %s (%s) failed — will retry", row.id, row.prefix)
            continue
        db.delete(row)
        done += 1
        logger.info("purged %s: %d file(s)", row.prefix, removed)
    db.commit()
    return done, failed


def run_retention(db: Session, days: int, today: date | None = None) -> int:
    """Стереть аудио смен старше `days` дней; вернуть, сколько смен затронуто.

    Смены в записи, в очереди и в разборе не трогаются: их аудио сейчас
    нужно. Стирается то, по чему можно узнать голос, — сегменты и склейка;
    расшифровка остаётся (её и так видно в отчёте текстом), и пересчёт по
    новым метрикам продолжает работать."""
    if days <= 0:
        return 0
    cutoff = (today or date.today()) - timedelta(days=days)
    recs = db.execute(
        select(AaRecording)
        .where(
            AaRecording.date < cutoff,
            AaRecording.status.not_in(("recording", "queued", "processing")),
            AaRecording.audio_purged_at.is_(None),
        )
        .order_by(AaRecording.date)
        .limit(500)
    ).scalars().all()
    purged = 0
    for rec in recs:
        keys = set(
            db.scalars(select(AaSegment.audio_uri).where(AaSegment.recording_id == rec.id))
        )
        keys.add(storage.merged_key(str(rec.id)))
        if rec.raw_audio_uri:
            keys.add(rec.raw_audio_uri)
        try:
            for key in sorted(keys):
                storage.delete_key(key)
        except Exception:  # noqa: BLE001
            logger.exception("retention: audio of %s not deleted — will retry", rec.id)
            db.rollback()
            continue
        rec.audio_purged_at = datetime.now(timezone.utc)
        rec.raw_audio_uri = None
        db.commit()
        purged += 1
    if purged:
        logger.info("retention: audio of %d recording(s) older than %s deleted", purged, cutoff)
    return purged


# --- Замок «воркер один» ------------------------------------------------------------

class WorkerLock:
    """Сессионный advisory lock Postgres на отдельном соединении.

    Держится, пока живо соединение: процесс умер или его убили — база сама
    отпускает замок, и следующий воркер его берёт. Поэтому DATABASE_URL —
    прямое подключение или пулер в режиме session: в режиме transaction
    замок «прилипал» бы к чужим соединениям пулера."""

    KEY = "audio-analytics-worker"

    def __init__(self, engine):
        self.engine = engine
        self.conn = None
        # Сигнал жизни шлют оба потока (по таймеру и при взятии смены), а
        # соединение SQLAlchemy между потоками делить нельзя.
        self._mutex = threading.Lock()

    def try_acquire(self) -> bool:
        try:
            if self.conn is None:
                self.conn = self.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
            return bool(
                self.conn.execute(text("select pg_try_advisory_lock(hashtext(:k))"), {"k": self.KEY}).scalar()
            )
        except Exception:
            self.release()
            raise

    def held(self) -> bool:
        """Замок всё ещё наш — соединение живо и не переоткрывалось."""
        with self._mutex:
            return self._held()

    def _held(self) -> bool:
        if self.conn is None:
            return False
        try:
            return bool(
                self.conn.execute(
                    text(
                        "select exists (select 1 from pg_locks where locktype = 'advisory' and granted"
                        " and pid = pg_backend_pid() and objid = hashtext(:k)::oid)"
                    ),
                    {"k": self.KEY},
                ).scalar()
            )
        except Exception:  # noqa: BLE001 — соединение оборвалось: замка больше нет
            return False

    def release(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:  # noqa: BLE001
                pass
            self.conn = None


# --- Сигнал жизни ------------------------------------------------------------------

def write_heartbeat(db: Session, state: dict) -> None:
    _set_state(db, "worker", {**state, "beat_at": datetime.now(timezone.utc).isoformat()})
    db.commit()


class Heartbeat(threading.Thread):
    """Отдельный поток: разбор одной смены идёт часами, а «жив ли воркер»
    должно обновляться всё это время. Своя сессия на каждый сигнал —
    соединение основного потока занято разбором."""

    def __init__(self, state: dict, interval_s: float, lock: WorkerLock | None = None):
        super().__init__(name="heartbeat", daemon=True)
        self.state = state
        self.interval_s = interval_s
        self.lock = lock
        self.stopped = threading.Event()

    def beat(self) -> None:
        if self.lock is not None and not self.lock.held():
            # Соединение с замком оборвалось (перезапуск базы): другой воркер
            # мог уже взять работу. Честнее перезапуститься — start.sh
            # перезапустит контейнер, а смена вернётся в очередь.
            logger.error("worker lock lost (database connection dropped) — exiting")
            os._exit(3)
        db = dbmod.session_factory()
        try:
            write_heartbeat(db, dict(self.state))
        except Exception:  # noqa: BLE001 — база недоступна: следующий сигнал попробует снова
            logger.exception("heartbeat failed")
            db.rollback()
        finally:
            db.close()

    def run(self) -> None:
        while not self.stopped.is_set():
            self.beat()
            self.stopped.wait(self.interval_s)


# --- Главный цикл -------------------------------------------------------------------

class Worker:
    def __init__(self):
        self.settings = get_settings()
        self.stop = threading.Event()
        self.state = {
            "pid": os.getpid(),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "current_recording_id": None,
            "version": SERVICE_VERSION,
            "commit": os.environ.get("SOURCE_COMMIT") or None,
        }
        self.last_purge = 0.0
        self.retention_day: date | None = None
        self.purge_warned: set = set()

    def _session(self) -> Session:
        return dbmod.session_factory()

    def housekeeping(self) -> None:
        """Стирание файлов — не чаще раза в 30 с; срок хранения — раз в сутки."""
        now = time.monotonic()
        if now - self.last_purge >= 30:
            self.last_purge = now
            db = self._session()
            try:
                drain_purge(db, _warned=self.purge_warned)
            except Exception:  # noqa: BLE001
                db.rollback()
                logger.exception("storage purge pass failed")
            finally:
                db.close()
        today = date.today()
        if self.retention_day != today:
            db = self._session()
            try:
                purged = run_retention(db, self.settings.audio_retention_days, today)
                _set_state(db, "retention", {
                    "last_run_at": datetime.now(timezone.utc).isoformat(),
                    "retention_days": self.settings.audio_retention_days,
                    "purged_recordings": purged,
                })
                db.commit()
                self.retention_day = today
            except Exception:  # noqa: BLE001
                db.rollback()
                logger.exception("retention pass failed")
            finally:
                db.close()

    def acquire_lock(self) -> WorkerLock | None:
        """Дождаться, пока прежний воркер (старый контейнер при передеплое)
        отпустит замок. None — пришёл сигнал остановки раньше."""
        lock = WorkerLock(dbmod.get_engine())
        last_note = 0.0
        while not self.stop.is_set():
            try:
                if lock.try_acquire():
                    return lock
                if time.monotonic() - last_note > 60:
                    logger.info("another worker holds the lock (deploy in progress?) — waiting")
                    last_note = time.monotonic()
            except Exception:  # noqa: BLE001 — база недоступна: подождать и снова
                logger.exception("worker lock: database unavailable")
            self.stop.wait(5)
        return None

    def run(self) -> None:
        lock = self.acquire_lock()
        if lock is None:
            return
        db = self._session()
        try:
            reset_orphans(db)
        finally:
            db.close()

        heartbeat = Heartbeat(self.state, self.settings.worker_heartbeat_s, lock)
        heartbeat.start()
        logger.info("worker %s started (pid %s)", SERVICE_VERSION, os.getpid())
        try:
            while not self.stop.is_set():
                self.housekeeping()
                db = self._session()
                try:
                    claimed = claim_next(db)
                    if claimed is None:
                        db.close()
                        self.stop.wait(self.settings.worker_poll_interval_s)
                        continue
                    rec_id, full = claimed
                    self.state["current_recording_id"] = str(rec_id)
                    heartbeat.beat()
                    run_claimed(db, rec_id, full)
                except Exception:  # noqa: BLE001 — база моргнула: пауза и снова
                    db.rollback()
                    logger.exception("worker loop error")
                    self.stop.wait(self.settings.worker_poll_interval_s)
                finally:
                    self.state["current_recording_id"] = None
                    db.close()
        finally:
            heartbeat.stopped.set()
            lock.release()
            logger.info("worker stopped")


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    worker = Worker()
    for problem in worker.settings.problems():
        logger.warning("настройка: %s", problem)

    def on_signal(signum, _frame):
        # Посреди разбора остановиться нельзя: Docker дождётся и убьёт
        # процесс, а смена при следующем старте вернётся в очередь.
        logger.info("signal %s — stopping after the current step", signum)
        worker.stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    worker.run()


if __name__ == "__main__":
    main()
