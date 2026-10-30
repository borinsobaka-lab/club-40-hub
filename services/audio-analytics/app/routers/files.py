"""Раздача файлов локального хранилища по подписанной ссылке: GET /files/{token}.

Так выглядит «presigned URL» без S3: ссылку выдаёт сервис после проверки
прав (запись смены — /api/staff/audio, архив сборки — ответ апдейтеру), а
здесь проверяется только подпись и срок. Заголовки авторизации браузер в
<audio src> всё равно не отправит — поэтому право зашито в саму ссылку.

Range обязателен: склеенная смена — 12 часов Ogg Opus, около 170 МБ, и плеер
админки при перемотке к разговору запрашивает нужный кусок (206 Partial
Content), а не качает файл с начала. FileResponse из Starlette ≥ 0.39 это
умеет (bytes=…, If-Range, 416 на неверный диапазон); тест test_files.py
держит это поведение.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import storage
from ..config import get_settings
from ..signing import TokenError, read_token

router = APIRouter(tags=["файлы"])


@router.api_route("/files/{token}", methods=["GET", "HEAD"], include_in_schema=False)
def serve_file(token: str):
    store = storage.get_storage()
    if not isinstance(store, storage.LocalStorage):
        # При S3 ссылки ведут прямо в хранилище; этот адрес не используется.
        raise HTTPException(404, "Файл не найден")
    try:
        key = read_token(token, get_settings().files_url_secret)
    except TokenError as e:
        raise HTTPException(403, str(e)) from None
    try:
        path = store.path_for(key)
    except ValueError:
        raise HTTPException(403, "недопустимый путь") from None
    if not path.is_file():
        raise HTTPException(404, "Файл не найден — возможно, он уже стёрт")
    filename = key.rsplit("/", 1)[-1]
    return FileResponse(
        path,
        media_type=storage.content_type_for(key),
        # Ссылка личная и временная: промежуточным кэшам её хранить незачем,
        # а браузеру — можно, пока она живёт (перемотка туда-обратно).
        headers={"Cache-Control": "private, max-age=600"},
        filename=filename,
        content_disposition_type="inline",
    )
