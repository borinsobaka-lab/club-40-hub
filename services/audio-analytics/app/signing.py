"""Подписанные ссылки на файлы локального хранилища: /files/{token}.

При хранении в S3 (R2) ссылку подписывает само хранилище (presigned URL).
На своём диске подписывает сервис — тем же способом по смыслу: в токене
ключ файла и срок годности, к ним подпись HMAC-SHA256 ключом
FILES_URL_SECRET. Подделать путь или продлить срок без ключа нельзя, а
выдаёт ссылки только сервис — после проверки прав (запись дня) или ключа
приложения (архив сборки).

Формат: base64url("<срок unix>:<ключ>") + "." + base64url(подпись). Токен
целиком — один сегмент пути: в base64url нет «/», «?» и «#».
"""
import base64
import binascii
import hashlib
import hmac
import re
import time


class TokenError(Exception):
    """Ссылка не подходит. `expired` — подпись верна, но срок вышел: плеер
    админки в этом случае просто запрашивает новую ссылку."""

    def __init__(self, message: str, expired: bool = False):
        super().__init__(message)
        self.expired = expired


# Ключ файла: «папка/папка/файл» из латиницы, цифр, точки, дефиса и
# подчёркивания. Другие ключи сервис не создаёт (recordings/<id>/seg_00000.opus,
# app-releases/darwin/1.2.3/app.tar.gz), поэтому всё прочее — отказ.
_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def validate_key(key: str) -> str:
    """Проверить ключ хранилища; вернуть его же или ValueError.

    Защита от выхода за пределы хранилища на диске: «..», абсолютный путь,
    обратный слэш, пустые части пути и любые необычные символы отвергаются
    до того, как ключ превратится в путь к файлу."""
    if not isinstance(key, str) or not key or len(key) > 512:
        raise ValueError("пустой или слишком длинный ключ")
    if key.startswith("/") or "\\" in key or "\x00" in key:
        raise ValueError("недопустимый ключ")
    parts = key.split("/")
    for part in parts:
        if part in ("", ".", "..") or not _SEGMENT_RE.match(part):
            raise ValueError("недопустимый ключ")
    return key


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(payload: bytes, secret: str) -> bytes:
    if not secret:
        raise TokenError("FILES_URL_SECRET не задан")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()


def make_token(key: str, expires_at: int, secret: str) -> str:
    validate_key(key)
    payload = f"{int(expires_at)}:{key}".encode("utf-8")
    return f"{_b64e(payload)}.{_b64e(_sign(payload, secret))}"


def read_token(token: str, secret: str, now: float | None = None) -> str:
    """Ключ файла из токена; TokenError, если подпись не сходится, срок вышел
    или ключ недопустим. Подпись проверяется раньше всего остального: на
    поддельный токен сервис не тратит ни разбора, ни обращения к диску."""
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64d(payload_b64)
        signature = _b64d(sig_b64)
    except (ValueError, binascii.Error):
        raise TokenError("ссылка повреждена") from None
    # Сравнение постоянного времени: обычное «==» выходит раньше на первом
    # несовпавшем байте и по времени ответа выдаёт, насколько угадали.
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        raise TokenError("подпись ссылки не сходится")
    try:
        expires_s, key = payload.decode("utf-8").split(":", 1)
        expires_at = int(expires_s)
    except (UnicodeDecodeError, ValueError):
        raise TokenError("ссылка повреждена") from None
    if (now if now is not None else time.time()) > expires_at:
        raise TokenError("срок ссылки истёк — обновите страницу", expired=True)
    try:
        return validate_key(key)
    except ValueError:
        raise TokenError("недопустимый путь") from None
