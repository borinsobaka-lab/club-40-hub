"""API приложения записи на ресепшене (Tauri, desktop/ прежнего проекта).

Контракт — в точности прежний: пути, заголовки, тела запросов, коды ответов
и их смысл. Приложение после переезда меняет только адрес сервера. Особенно
важен 409: на него приложение считает смену закрытой на сервере и перестаёт
дозагружать куски (uploader.rs, RecordingClosed).
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .. import storage
from ..auth import DeviceContext, require_app, require_device
from ..config import get_settings
from ..db import get_db
from ..models import AaAppRelease, AaLocation, AaManager, AaRecording, AaSegment
from ..releases import version_key
from ..schemas import (
    DayFinishRequest,
    DayRecordingOut,
    DayStartRequest,
    EmployeePickOut,
    LocationPickOut,
    SegmentUploadedOut,
    UpdateManifest,
)

router = APIRouter(tags=["приложение на ресепшене"])

# Номер куска — пятизначный в имени файла (seg_00042.opus); 100 000 пятиминутных
# кусков — это год записи без перерыва, дальше — явная ошибка приложения.
MAX_SEGMENT_IDX = 99_999


def day_out(db: Session, rec: AaRecording) -> DayRecordingOut:
    settings = get_settings()
    location_name = db.scalar(select(AaLocation.name).where(AaLocation.id == rec.location_id))
    manager_name = (
        db.scalar(select(AaManager.full_name).where(AaManager.id == rec.manager_id))
        if rec.manager_id
        else None
    )
    changed = rec.status_changed_at
    stale = bool(
        rec.status in ("queued", "processing")
        and changed is not None
        and changed < datetime.now(timezone.utc) - timedelta(seconds=settings.stale_processing_s)
    )
    return DayRecordingOut(
        id=rec.id,
        location_id=rec.location_id,
        location_name=location_name,
        date=rec.date,
        status=rec.status,
        status_detail=rec.status_detail or "",
        status_changed_at=changed,
        stale=stale,
        total_duration_s=rec.total_duration_s,
        speech_duration_s=rec.speech_duration_s,
        created_at=rec.created_at,
        employee_id=rec.manager_id,
        employee_name=manager_name,
        metric_stats=[],
        asr_seconds=rec.asr_seconds,
        llm_input_tokens=rec.llm_input_tokens or 0,
        llm_output_tokens=rec.llm_output_tokens or 0,
        llm_calls=rec.llm_calls or 0,
        cost_usd=rec.cost_usd,
    )


@router.get("/api/recordings/locations", response_model=list[LocationPickOut])
def list_pickable_locations(_: None = Depends(require_app), db: Session = Depends(get_db)):
    """Список точек продажи для настройки приложения.

    Отвечает на ключ приложения, без привязки к точке: приложение только что
    установили, и точку как раз предстоит выбрать. Наружу отдаются имя и
    адрес — по ним сотрудник узнаёт свою студию.
    """
    rows = db.scalars(
        select(AaLocation).where(AaLocation.active.is_(True)).order_by(AaLocation.name)
    ).all()
    return [LocationPickOut(id=r.id, name=r.name, address=r.address or "") for r in rows]


@router.get("/api/recordings/employees", response_model=list[EmployeePickOut])
def list_pickable_employees(
    device: DeviceContext = Depends(require_device), db: Session = Depends(get_db)
):
    """Все активные менеджеры — независимо от выбранной точки продажи.

    Сотрудник не закреплён за студией: сегодня он на Ваке, завтра подменяет
    на Сабуртало, и заводить его дважды или переназначать перед сменой никто
    не будет. Смена всё равно достаётся той точке, на которой стоит компьютер.
    """
    rows = db.scalars(
        select(AaManager).where(AaManager.active.is_(True)).order_by(AaManager.full_name)
    ).all()
    return [
        EmployeePickOut(
            id=m.id, location_id=device.location_id, full_name=m.full_name, role="manager", active=True
        )
        for m in rows
    ]


@router.post("/api/recordings/start", response_model=DayRecordingOut)
def start_day(
    body: DayStartRequest,
    device: DeviceContext = Depends(require_device),
    db: Session = Depends(get_db),
):
    """Resume the session still in progress, otherwise open a new one.

    Only a recording that is still in the `recording` state is resumed — that
    is the app-restarted-after-a-crash case. A day that was already finished
    stays untouched and a second session gets its own recording and report.
    """
    if body.employee_id:
        # Проверяем только существование: к точке менеджер не привязан и может
        # выйти на любой студии.
        if not db.get(AaManager, body.employee_id):
            raise HTTPException(404, "Менеджер не найден")

    in_progress = db.scalar(
        select(AaRecording)
        .where(
            AaRecording.location_id == device.location_id,
            AaRecording.date == body.date,
            AaRecording.status == "recording",
        )
        .order_by(AaRecording.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if in_progress:
        # Let a resumed session pick up the manager chosen on restart.
        if body.employee_id and in_progress.manager_id != body.employee_id:
            in_progress.manager_id = body.employee_id
        db.commit()
        return day_out(db, in_progress)

    rec = AaRecording(
        location_id=device.location_id,
        manager_id=body.employee_id,
        date=body.date,
        status="recording",
        status_detail="",
    )
    db.add(rec)
    db.commit()
    return day_out(db, rec)


def _read_limited(upload: UploadFile, limit: int) -> bytes:
    """Прочитать файл не больше limit байт; больше — 413, а не память сервера."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = upload.file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, f"Сегмент больше {limit // (1024 * 1024)} МБ")
        chunks.append(chunk)
    return b"".join(chunks)


@router.put("/api/recordings/{recording_id}/segments/{idx}", response_model=SegmentUploadedOut)
def upload_segment(
    recording_id: uuid.UUID,
    idx: int,
    file: UploadFile,
    device: DeviceContext = Depends(require_device),
    db: Session = Depends(get_db),
):
    """Idempotent chunk upload: re-uploading the same idx overwrites the object."""
    rec = db.get(AaRecording, recording_id)
    if not rec or rec.location_id != device.location_id:
        raise HTTPException(404, "Смена не найдена")
    if rec.status not in ("recording", "uploaded"):
        raise HTTPException(409, f"Смена уже закрыта, статус «{rec.status}»")
    if idx < 0 or idx > MAX_SEGMENT_IDX:
        raise HTTPException(400, "Недопустимый номер сегмента")

    data = _read_limited(file, get_settings().max_segment_mb * 1024 * 1024)
    if not data:
        raise HTTPException(400, "Пустой файл")
    key = storage.segment_key(str(recording_id), idx)
    storage.upload_bytes(key, data, content_type="audio/ogg")

    # Повторная загрузка того же номера (приложение не дождалось ответа)
    # перезаписывает файл — значит, и размер в строке должен быть новым.
    stmt = pg_insert(AaSegment).values(
        id=uuid.uuid4(), recording_id=recording_id, idx=idx, audio_uri=key, size_bytes=len(data)
    )
    seg_id = db.scalar(
        stmt.on_conflict_do_update(
            index_elements=[AaSegment.recording_id, AaSegment.idx],
            set_={
                "audio_uri": stmt.excluded.audio_uri,
                "size_bytes": stmt.excluded.size_bytes,
                "uploaded_at": func.now(),
            },
        ).returning(AaSegment.id)
    )
    db.commit()
    return SegmentUploadedOut(id=seg_id, idx=idx)


@router.post("/api/recordings/{recording_id}/finish", response_model=DayRecordingOut)
def finish_day(
    recording_id: uuid.UUID,
    body: DayFinishRequest,
    device: DeviceContext = Depends(require_device),
    db: Session = Depends(get_db),
):
    """Смена закрыта в приложении: сегменты на месте, разбор не запускается.

    Запуск — отдельным нажатием в админке. Автоматический разбор всего
    подряд обходился в деньги на пустых днях, неудачных дублях и проверках
    оборудования; владелец сам решает, какую смену стоит разобрать.
    """
    rec = db.get(AaRecording, recording_id, with_for_update=True)
    if not rec or rec.location_id != device.location_id:
        raise HTTPException(404, "Смена не найдена")
    if rec.status == "uploaded":
        # Повторное «завершить» (приложение не дождалось ответа) — уже сделано.
        db.commit()
        return day_out(db, rec)
    if rec.status != "recording":
        # Смену уже закрыли из админки и разобрали: опоздавший запрос не должен
        # откатывать «готово» обратно в «ждёт разбора». Приложение по 409
        # понимает, что дозагружать больше нечего.
        raise HTTPException(409, f"Смена уже закрыта, статус «{rec.status}»")

    count = db.scalar(
        select(func.count()).select_from(AaSegment).where(AaSegment.recording_id == recording_id)
    )
    if count < body.total_segments:
        raise HTTPException(
            409,
            f"Загружено {count} из {body.total_segments} сегментов — дозагрузите недостающие",
        )

    rec.set_status("uploaded", "запись завершена, ждёт запуска разбора")
    db.commit()
    return day_out(db, rec)


@router.get("/api/app/update/{platform}/{arch}/{current_version}")
def check_update(
    platform: str,
    arch: str,
    current_version: str,
    _: None = Depends(require_app),
    db: Session = Depends(get_db),
):
    """Ответ апдейтеру Tauri: 204 — обновлять нечего, 200 с манифестом — есть.

    Архитектура (`arch`) в ответе не участвует: под macOS собирается один
    универсальный бандл на Intel и Apple Silicon, поэтому обеим машинам
    отдаётся один и тот же архив.
    """
    releases = db.scalars(
        select(AaAppRelease).where(
            AaAppRelease.platform == platform, AaAppRelease.published.is_(True)
        )
    ).all()
    if not releases:
        return Response(status_code=204)

    latest = max(releases, key=lambda r: version_key(r.version))
    if version_key(latest.version) <= version_key(current_version):
        return Response(status_code=204)

    return UpdateManifest(
        version=latest.version,
        notes=latest.notes,
        pub_date=latest.created_at,
        # Ссылка временная: архив лежит в закрытом хранилище, публичного
        # адреса у него нет.
        url=storage.presigned_get_url(latest.archive_uri),
        signature=latest.signature,
    )
