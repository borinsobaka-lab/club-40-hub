"""Схемы ответов API.

Ответы приложению на ресепшене — в точности прежние (schemas.py проекта
audio-analitics): приложение Tauri уже стоит на компьютерах студий и после
переезда должно работать, поменяв только адрес сервера. Оно читает не все
поля, но форма сохранена целиком — дешевле, чем выяснять, какое поле читает
какая из разошедшихся по студиям версий.
"""
import uuid
from datetime import date, datetime

from pydantic import BaseModel


# --- Приложение на ресепшене ---

class DayStartRequest(BaseModel):
    date: date
    employee_id: uuid.UUID | None = None


class DayMetricStat(BaseModel):
    metric_id: uuid.UUID
    name: str
    scale_max: int
    triggered_count: int
    avg_score: float | None


class DayRecordingOut(BaseModel):
    id: uuid.UUID
    location_id: uuid.UUID
    location_name: str | None = None
    date: date
    status: str
    status_detail: str = ""
    status_changed_at: datetime | None = None
    # Смена «в очереди» или «обрабатывается», но статус не двигался дольше
    # положенного — воркер её потерял.
    stale: bool = False
    total_duration_s: float | None = None
    speech_duration_s: float | None = None
    created_at: datetime | None = None
    # employee_* — прежние имена: в новой схеме это менеджер (aa_managers).
    employee_id: uuid.UUID | None = None
    employee_name: str | None = None
    metric_stats: list[DayMetricStat] = []
    # Стоимость последней обработки и расход, из которого она получена.
    asr_seconds: float | None = None
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    llm_calls: int = 0
    cost_usd: float | None = None


class DayFinishRequest(BaseModel):
    total_segments: int


class SegmentUploadedOut(BaseModel):
    id: uuid.UUID
    idx: int


class LocationPickOut(BaseModel):
    """То, что видит приложение на ресепшене в списке «Точка продажи»."""

    id: uuid.UUID
    name: str
    address: str = ""


class EmployeePickOut(BaseModel):
    """То, что видит приложение на ресепшене: только выбор имени.

    location_id — точка устройства: менеджер к точке не привязан (подменяет
    на соседней студии), а смена достаётся той точке, где стоит компьютер.
    role всегда «manager» — других ролей в списке приложения не бывает."""

    id: uuid.UUID
    location_id: uuid.UUID
    full_name: str
    role: str = "manager"
    active: bool = True


class UpdateManifest(BaseModel):
    """Ответ апдейтеру Tauri. Имена полей заданы им, менять нельзя."""

    version: str
    notes: str = ""
    pub_date: datetime
    url: str
    signature: str


# --- Админка ---

class AudioUrlOut(BaseModel):
    url: str
    expires_in_s: int


class AppReleaseOut(BaseModel):
    id: uuid.UUID
    platform: str
    version: str
    notes: str = ""
    size_bytes: int = 0
    published: bool = True
    created_by_name: str = ""
    created_at: datetime

    model_config = {"from_attributes": True}
