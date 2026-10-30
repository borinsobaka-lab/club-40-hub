"""Кто обращается к сервису.

1. Приложение на ресепшене — ключ приложения (X-App-Key, один на всю сеть,
   вшит в сборку) плюс выбранная точка продажи (X-Location-Id). Прежняя
   схема со своим ключом на каждое устройство (X-Device-Key) не перенесена:
   все приложения давно настроены на общий ключ и выбор точки.
2. Сотрудник из админки портала — токен входа Supabase
   (Authorization: Bearer). Подлинность проверяет сам GoTrue
   (/auth/v1/user), права — функции базы из миграции «Аудиоаналитики»
   (aa_has, aa_recording_visible): правило доступа одно, и живёт оно в базе
   рядом с RLS, а не дублируется здесь.
"""
import hashlib
import hmac
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass

import httpx
from fastapi import Depends, Header, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AaLocation

logger = logging.getLogger(__name__)


# --- Приложение на ресепшене -----------------------------------------------------

@dataclass
class DeviceContext:
    location_id: uuid.UUID


def _app_key_ok(x_app_key: str) -> bool:
    key = get_settings().app_key
    return bool(key) and hmac.compare_digest(x_app_key.encode(), key.encode())


def require_app(x_app_key: str = Header(default="")) -> None:
    """Приложение записи без привязки к точке — только чтобы получить список
    точек продажи для выбора в настройках."""
    if not get_settings().app_key:
        raise HTTPException(500, "APP_KEY не задан на сервере")
    if not _app_key_ok(x_app_key):
        raise HTTPException(401, "Неверный ключ приложения")


def require_device(
    x_app_key: str = Header(default=""),
    x_location_id: str = Header(default=""),
    db: Session = Depends(get_db),
) -> DeviceContext:
    """Ключ приложения плюс выбранная точка продажи — открытая."""
    require_app(x_app_key)
    try:
        location_id = uuid.UUID(x_location_id)
    except ValueError:
        raise HTTPException(400, "Не выбрана точка продажи") from None
    location = db.get(AaLocation, location_id)
    if not location or not location.active:
        raise HTTPException(404, "Точка продажи не найдена или закрыта")
    return DeviceContext(location_id=location.id)


# --- Сотрудник из админки ----------------------------------------------------------

@dataclass
class StaffUser:
    id: uuid.UUID
    email: str = ""


class TokenVerifier:
    """Проверка токена Supabase через GoTrue с кэшем на минуту.

    Плеер админки просит ссылку на запись при каждом открытии смены, а
    GoTrue — тот же сервер; минута кэша снимает лишние запросы и при этом
    не держит отозванный вход дольше минуты. В кэше — хэш токена, не сам
    токен."""

    TTL_S = 60.0
    MAX_ENTRIES = 2000

    def __init__(self):
        self._cache: dict[str, tuple[float, StaffUser]] = {}
        self._lock = threading.Lock()

    def verify(self, token: str) -> StaffUser | None:
        key = hashlib.sha256(token.encode()).hexdigest()
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] > now:
                return hit[1]
        user = self._ask_gotrue(token)
        if user is None:
            return None
        with self._lock:
            if len(self._cache) >= self.MAX_ENTRIES:
                self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
                if len(self._cache) >= self.MAX_ENTRIES:
                    self._cache.clear()
            self._cache[key] = (now + self.TTL_S, user)
        return user

    def _ask_gotrue(self, token: str) -> StaffUser | None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise HTTPException(500, "SUPABASE_URL / SUPABASE_ANON_KEY не заданы на сервере")
        try:
            resp = httpx.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
                timeout=10.0,
            )
        except httpx.HTTPError as e:
            logger.warning("GoTrue is unreachable: %s", e)
            raise HTTPException(503, "Не удалось проверить вход — сервер авторизации недоступен") from None
        if resp.status_code in (401, 403):
            return None
        if resp.status_code >= 400:
            logger.warning("GoTrue answered %s: %s", resp.status_code, resp.text[:300])
            raise HTTPException(503, "Не удалось проверить вход — попробуйте ещё раз")
        try:
            data = resp.json()
            return StaffUser(id=uuid.UUID(str(data["id"])), email=str(data.get("email") or ""))
        except (ValueError, KeyError, TypeError):
            return None


verifier = TokenVerifier()


def current_staff(authorization: str = Header(default="")) -> StaffUser:
    """Вошедший в админку человек (права — отдельно, в базе)."""
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Нет токена входа")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(401, "Нет токена входа")
    user = verifier.verify(token)
    if user is None:
        raise HTTPException(401, "Вход недействителен — войдите в админку заново")
    return user


def _as_user(db: Session, user_id: uuid.UUID) -> None:
    """Представиться базе этим пользователем (только на текущую транзакцию):
    функции прав читают auth.uid(), а он — из этих настроек, как у PostgREST."""
    uid = str(user_id)
    db.execute(
        text(
            "select set_config('request.jwt.claim.sub', :uid, true),"
            " set_config('request.jwt.claim.role', 'authenticated', true),"
            " set_config('request.jwt.claims', :claims, true)"
        ),
        {"uid": uid, "claims": json.dumps({"sub": uid, "role": "authenticated"})},
    )


def recording_visible(db: Session, user: StaffUser, recording_id: uuid.UUID) -> bool:
    """Видна ли смена: «все смены», «настройки» или своя (aa_recording_visible).

    Проверка — в отдельной транзакции, которая сразу откатывается: настройки
    «я — этот пользователь» не должны пережить её."""
    try:
        _as_user(db, user.id)
        return bool(db.scalar(text("select public.aa_recording_visible(:id)"), {"id": recording_id}))
    finally:
        db.rollback()


def has_right(db: Session, user: StaffUser, right: str) -> bool:
    try:
        return bool(
            db.scalar(text("select public.aa_has(:uid, :right)"), {"uid": user.id, "right": right})
        )
    finally:
        db.rollback()


def display_name(db: Session, user: StaffUser) -> str:
    """Имя для подписей (профиль портала, иначе почта) — как aa_my_name()."""
    try:
        _as_user(db, user.id)
        name = db.scalar(text("select public.aa_my_name()"))
        return (name or user.email or "").strip()
    finally:
        db.rollback()


def require_manage(
    user: StaffUser = Depends(current_staff), db: Session = Depends(get_db)
) -> StaffUser:
    """Право «Аудиоаналитика: настройки» (audio.manage)."""
    if not has_right(db, user, "audio.manage"):
        raise HTTPException(403, "Недостаточно прав: нужно право «Аудиоаналитика: настройки»")
    return user
