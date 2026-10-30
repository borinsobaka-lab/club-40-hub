"""API для админки портала: запись смены в плеере, загрузка сборок, состояние.

Всё остальное админка делает сама через Supabase (RLS и RPC миграции):
списки смен, отчёты, метрики, промпты, запуск разбора, удаление, «согласен /
не согласен», договорённости, снятие сборки с публикации. Сюда пришло только
то, чего база сделать не может: подписать ссылку на файл и принять файл.

Чужая смена отвечает 404, а не 403: «нельзя» подтверждало бы, что такая
смена есть, а по идентификатору можно перебирать.
"""
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import storage
from ..auth import StaffUser, current_staff, display_name, recording_visible, require_manage
from ..config import get_settings
from ..db import get_db
from ..models import AaAppRelease, AaRecording, AaServiceState, AaStoragePurge
from ..releases import MAX_ARCHIVE_MB, PLATFORMS, valid_version, version_from_archive
from ..schemas import AppReleaseOut, AudioUrlOut
from ..version import SERVICE_VERSION

router = APIRouter(prefix="/api/staff", tags=["админка"])


@router.get("/audio/{recording_id}", response_model=AudioUrlOut)
def day_audio_url(
    recording_id: uuid.UUID,
    user: StaffUser = Depends(current_staff),
    db: Session = Depends(get_db),
):
    """Ссылка на склеенную запись смены; плеер перематывает к началу разговора.

    Ссылка временная (PRESIGNED_URL_TTL_S): протухшую плеер просит заново."""
    if not recording_visible(db, user, recording_id):
        raise HTTPException(404, "Смена не найдена")
    rec = db.get(AaRecording, recording_id)
    if not rec:
        raise HTTPException(404, "Смена не найдена")
    if rec.audio_purged_at is not None:
        days = get_settings().audio_retention_days
        raise HTTPException(
            410,
            f"Аудио смены стёрто по сроку хранения ({days} дн.) — разбор и текст разговоров остались",
        )
    if not rec.raw_audio_uri:
        raise HTTPException(404, "Записи смены целиком ещё нет — она появляется после разбора")
    ttl = get_settings().presigned_url_ttl_s
    return AudioUrlOut(url=storage.presigned_get_url(rec.raw_audio_uri, ttl), expires_in_s=ttl)


def _save_limited(upload: UploadFile, limit: int) -> tuple[str, int]:
    """Сохранить загруженный файл во временный, не больше limit байт.

    Сборка весит десятки мегабайт, держать её целиком в памяти незачем."""
    fd, path = tempfile.mkstemp(prefix="release-", suffix=".tar.gz")
    total = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise HTTPException(413, f"Сборка больше {MAX_ARCHIVE_MB} МБ")
                out.write(chunk)
    except BaseException:
        os.unlink(path)
        raise
    return path, total


@router.post("/releases", response_model=AppReleaseOut, status_code=201)
def upload_release(
    archive: UploadFile = File(..., description="Audio Recorder.app.tar.gz"),
    signature_file: UploadFile | None = File(default=None, description="…tar.gz.sig"),
    signature: str = Form(default=""),
    version: str = Form(default=""),
    platform: str = Form(default="darwin"),
    notes: str = Form(default=""),
    user: StaffUser = Depends(require_manage),
    db: Session = Depends(get_db),
):
    """Выложить сборку: архив и подпись, которые tauri build кладёт рядом.

    Снять с публикации, поправить заметки и удалить админка может сама (RLS);
    удаление ставит архив в очередь стирания триггером в базе."""
    platform = platform.strip()
    if platform not in PLATFORMS:
        raise HTTPException(400, f"Неизвестная платформа «{platform}»")

    path, size = _save_limited(archive, MAX_ARCHIVE_MB * 1024 * 1024)
    try:
        if size == 0:
            raise HTTPException(400, "Пустой файл сборки")

        signature_text = signature.strip()
        if signature_file is not None:
            signature_text = signature_file.file.read(64 * 1024).decode("utf-8", "ignore").strip()
        if not signature_text:
            raise HTTPException(
                400, "Нет подписи: приложите файл .tar.gz.sig, который лежит рядом со сборкой"
            )

        with open(path, "rb") as fh:
            resolved = version_from_archive(fh) or version.strip()
        if not valid_version(resolved):
            raise HTTPException(
                400, "Не удалось определить версию сборки — укажите её вручную в виде 1.2.3"
            )

        duplicate = db.scalar(
            select(AaAppRelease.id).where(
                AaAppRelease.platform == platform, AaAppRelease.version == resolved
            )
        )
        if duplicate:
            raise HTTPException(
                409,
                f"Версия {resolved} уже выложена. Поднимите номер версии в "
                "tauri.conf.json и соберите заново — иначе приложения не увидят "
                "обновление.",
            )

        key = storage.release_key(platform, resolved)
        storage.upload_file(key, path, content_type="application/gzip")
        author = display_name(db, user)
        release = AaAppRelease(
            platform=platform,
            version=resolved,
            notes=notes.strip(),
            archive_uri=key,
            signature=signature_text,
            size_bytes=size,
            published=True,
            created_by_name=author,
        )
        db.add(release)
        try:
            db.commit()
        except IntegrityError:
            # Одновременная загрузка той же версии: файл тот же ключ, его не трогаем.
            db.rollback()
            raise HTTPException(409, f"Версия {resolved} уже выложена") from None
        return AppReleaseOut.model_validate(release)
    finally:
        Path(path).unlink(missing_ok=True)


@router.get("/status")
def service_status(user: StaffUser = Depends(require_manage), db: Session = Depends(get_db)):
    """Состояние сервиса для «Настроек» админки: что настроено, жив ли воркер,
    что в очереди. Секретов здесь нет — только «задан / не задан»."""
    settings = get_settings()
    states = {s.key: s for s in db.scalars(select(AaServiceState)).all()}
    now = datetime.now(timezone.utc)

    worker_state = states.get("worker")
    worker = None
    if worker_state:
        beat = worker_state.updated_at
        age = (now - beat).total_seconds() if beat else None
        worker = {
            **(worker_state.value or {}),
            "heartbeat_age_s": round(age, 1) if age is not None else None,
            # Три пропущенных сигнала подряд — воркер, скорее всего, мёртв.
            "alive": age is not None and age < settings.worker_heartbeat_s * 3 + 10,
        }

    counts = dict(
        db.execute(
            select(AaRecording.status, func.count())
            .where(AaRecording.status.in_(("queued", "processing")))
            .group_by(AaRecording.status)
        ).all()
    )
    stale = db.scalar(
        select(func.count())
        .select_from(AaRecording)
        .where(
            AaRecording.status.in_(("queued", "processing")),
            AaRecording.status_changed_at < now - timedelta(seconds=settings.stale_processing_s),
        )
    )
    purge_pending = db.scalar(select(func.count()).select_from(AaStoragePurge))
    retention = states.get("retention")

    return {
        "version": SERVICE_VERSION,
        "commit": os.environ.get("SOURCE_COMMIT") or None,
        "environment": settings.environment,
        "storage_backend": settings.storage_backend,
        "public_url": settings.public_base,
        "asr_configured": settings.asr_configured,
        "llm_configured": settings.llm_configured,
        "app_key_set": bool(settings.app_key),
        "worker": worker,
        "queue": {
            "queued": counts.get("queued", 0),
            "processing": counts.get("processing", 0),
            "stale": stale or 0,
        },
        "storage_purge_pending": purge_pending or 0,
        "retention": {
            "audio_retention_days": settings.audio_retention_days,
            **((retention.value or {}) if retention else {}),
        },
        "models": {
            "asr": settings.elevenlabs_model_id,
            "stage1": settings.llm_model_stage1,
            "stage2": settings.llm_model_stage2,
        },
    }
