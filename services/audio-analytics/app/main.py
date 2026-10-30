"""API сервиса «Аудиоаналитика»: приём записи с ресепшенов и файлы для админки.

Запуск: uvicorn app.main:app (в контейнере — вместе с воркером, start.sh).
"""
import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .routers import device, files, staff
from .version import SERVICE_VERSION

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

settings = get_settings()
production = settings.environment != "development"
for problem in settings.problems():
    logging.getLogger("api").warning("настройка: %s", problem)

app = FastAPI(
    title=settings.app_name,
    version=SERVICE_VERSION,
    # Описание API наружу в проде не нужно: им пользуются только приложение
    # и админка, а лишняя страница — лишняя поверхность.
    docs_url=None if production else "/docs",
    redoc_url=None,
    openapi_url=None if production else "/openapi.json",
)

origins = settings.cors_origin_list()
if not origins and not production:
    origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # Админка ходит с токеном в заголовке, а не с cookie.
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    # Каждый запрос с токеном браузер сначала «согласует» отдельным OPTIONS;
    # разрешение кэшируется на сутки (Chrome держит до 2 часов).
    max_age=86400,
)

# Предел тела запроса до разбора multipart: Starlette сначала сохраняет весь
# файл во временную папку и только потом отдаёт его обработчику — проверка
# размера там пришла бы после того, как гигабайт мусора уже на диске.
_BODY_LIMITS = (
    ("/api/recordings/", lambda: (settings.max_segment_mb + 1) * 1024 * 1024),
    ("/api/staff/releases", lambda: (300 + 1) * 1024 * 1024),
)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    if request.method in ("POST", "PUT"):
        length = request.headers.get("content-length")
        for prefix, limit in _BODY_LIMITS:
            if request.url.path.startswith(prefix) and length and length.isdigit():
                if int(length) > limit():
                    return JSONResponse({"detail": "Слишком большой файл"}, status_code=413)
    return await call_next(request)


app.include_router(device.router)
app.include_router(staff.router)
app.include_router(files.router)


@app.get("/health", include_in_schema=False)
def health():
    """Для HEALTHCHECK контейнера: процесс API отвечает. Жив ли воркер —
    видно по сигналу жизни в /api/staff/status (а падение воркера и так
    перезапускает контейнер — start.sh)."""
    return {"status": "ok", "version": SERVICE_VERSION}
