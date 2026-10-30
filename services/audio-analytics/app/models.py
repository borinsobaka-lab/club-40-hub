"""ORM-модели поверх таблиц aa_* (db/migrations/2026-10-30_audio_analytics.sql).

Схему создаёт и меняет только мигратор портала (db/migrate.ts при старте
админки) — здесь лишь отображение колонок, без create_all. Внешние ключи
объявлены только между таблицами aa_*: они нужны SQLAlchemy, чтобы в одной
записи вставлять диалог раньше его реплик и оценок; ссылки на auth.users и
studios живут в базе, сервису они не нужны.

Сервис подключается напрямую (DATABASE_URL), мимо RLS. Поэтому всё, что
здесь пишется, — то, что пишет только сервис: смены, сегменты, расшифровки,
диалоги, реплики, оценки, итоги, сборки приложения, состояние сервиса.
Справочники (точки, менеджеры, метрики, промпты) правит админка — сервис их
только читает.
"""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class AaLocation(Base):
    """Точка продажи — студия с одним ресепшеном, где стоит компьютер с
    приложением. Закрытая (active=False) не показывается в выборе, но её
    смены остаются в отчётах."""

    __tablename__ = "aa_locations"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text)
    address: Mapped[str] = mapped_column(Text, default="")
    timezone: Mapped[str] = mapped_column(Text, default="Asia/Tbilisi")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    studio_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaManager(Base):
    """Менеджер — имя в списке приложения. Деактивированный уходит из списка,
    но остаётся автором прошлых смен."""

    __tablename__ = "aa_managers"

    id: Mapped[uuid.UUID] = uuid_pk()
    full_name: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaRecording(Base):
    """Смена — одна сессия записи, обычно рабочий день точки.

    Deliberately NOT unique per (location, date): if the app crashes and the
    manager starts again, the unfinished session is resumed; after a finished
    one a second start becomes its own recording and its own report.
    """

    __tablename__ = "aa_recordings"

    id: Mapped[uuid.UUID] = uuid_pk()
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aa_locations.id"))
    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("aa_managers.id"), nullable=True
    )
    date: Mapped[date] = mapped_column(Date)
    # recording → uploaded → queued → processing → done | error
    status: Mapped[str] = mapped_column(Text, default="recording")
    status_detail: Mapped[str] = mapped_column(Text, default="")
    # Когда статус (или пояснение к нему) менялся в последний раз. По этому
    # времени админка отличает идущий разбор от разбора, который умер вместе
    # с воркером и завис в «обрабатывается».
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    process_full: Mapped[bool] = mapped_column(Boolean, default=False)
    queued_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    raw_audio_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    speech_duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Расход на обработку. Хранится вместе с итоговой суммой, потому что
    # тарифы меняются: по минутам и токенам прошлую смену можно пересчитать,
    # по одной сумме — уже нет.
    asr_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    llm_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    llm_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Аудио стёрто по сроку хранения (разбор и расшифровка остались).
    audio_purged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    def set_status(self, status: str | None = None, detail: str | None = None) -> None:
        """Сменить статус и/или пояснение, отметив момент изменения."""
        if status is not None:
            self.status = status
        if detail is not None:
            self.status_detail = detail
        self.status_changed_at = utcnow()


class AaSegment(Base):
    """Пятиминутный кусок записи из приложения (Ogg Opus)."""

    __tablename__ = "aa_segments"

    id: Mapped[uuid.UUID] = uuid_pk()
    recording_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aa_recordings.id", ondelete="CASCADE")
    )
    idx: Mapped[int] = mapped_column(Integer)
    audio_uri: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaTranscript(Base):
    __tablename__ = "aa_transcripts"

    id: Mapped[uuid.UUID] = uuid_pk()
    recording_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aa_recordings.id", ondelete="CASCADE")
    )
    asr_provider: Mapped[str] = mapped_column(Text, default="elevenlabs")
    language_hint: Mapped[str] = mapped_column(Text, default="auto")
    # Слова с таймкодами по исходной записи (JSON в хранилище) — пересчёт
    # берёт их и за распознавание второй раз не платит.
    raw_json_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaDialog(Base):
    __tablename__ = "aa_dialogs"

    id: Mapped[uuid.UUID] = uuid_pk()
    recording_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aa_recordings.id", ondelete="CASCADE")
    )
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    # sale | consultation | refusal | service | irrelevant
    type: Mapped[str] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    brief: Mapped[str] = mapped_column(Text, default="")


class AaDialogTurn(Base):
    __tablename__ = "aa_dialog_turns"

    id: Mapped[uuid.UUID] = uuid_pk()
    dialog_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aa_dialogs.id", ondelete="CASCADE")
    )
    speaker_label: Mapped[str] = mapped_column(Text)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)


class AaMetric(Base):
    """Метрика — название + инструкции модели + шкала. Пишет админка."""

    __tablename__ = "aa_metrics"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    scale_max: Mapped[int] = mapped_column(Integer, default=10)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class AaMetricEvaluation(Base):
    """Result of applying one metric to one dialog."""

    __tablename__ = "aa_metric_evaluations"

    id: Mapped[uuid.UUID] = uuid_pk()
    recording_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aa_recordings.id", ondelete="CASCADE")
    )
    dialog_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aa_dialogs.id", ondelete="CASCADE"))
    metric_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aa_metrics.id", ondelete="CASCADE"))
    applicable: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    good: Mapped[list] = mapped_column(JSONB, default=list)
    bad: Mapped[list] = mapped_column(JSONB, default=list)
    comment: Mapped[str] = mapped_column(Text, default="")


class AaDaySummary(Base):
    """Итог смены: число диалогов, продаж и сводка дня от модели."""

    __tablename__ = "aa_day_summaries"

    recording_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aa_recordings.id", ondelete="CASCADE"), primary_key=True
    )
    dialogs_total: Mapped[int] = mapped_column(Integer, default=0)
    sales_count: Mapped[int] = mapped_column(Integer, default=0)
    conversion: Mapped[float | None] = mapped_column(Float, nullable=True)
    # None — SQL NULL, а не JSON «null»: «сводки нет» должно выглядеть одинаково
    # и в базе, и в админке.
    summary: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)


class AaPrompt(Base):
    """Служебный промпт разбора; правка — новая версия, активна последняя.
    Пишет админка (aa_prompt_save)."""

    __tablename__ = "aa_prompts"

    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_by_name: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaAppRelease(Base):
    """Сборка приложения записи (апдейтер Tauri).

    Архив лежит в хранилище рядом с записями, а подпись — здесь: приложение
    проверяет её своим вшитым публичным ключом и не установит ничего, что
    подписано не нашим приватным ключом. Без этого «автообновление» означало
    бы «кто угодно, подменивший ответ сервера, ставит нам свой код».
    """

    __tablename__ = "aa_app_releases"

    id: Mapped[uuid.UUID] = uuid_pk()
    platform: Mapped[str] = mapped_column(Text)
    version: Mapped[str] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="")
    archive_uri: Mapped[str] = mapped_column(Text)
    signature: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    # Снятая с публикации сборка остаётся в истории, но приложениям не отдаётся.
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_name: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaStoragePurge(Base):
    """Очередь стирания файлов: строки базы удаляются сразу (удаление смены,
    сборки), файлы — следом, воркером."""

    __tablename__ = "aa_storage_purge"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    prefix: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class AaServiceState(Base):
    """Состояние сервиса: сигнал жизни воркера, срок хранения и т. п."""

    __tablename__ = "aa_service_state"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
