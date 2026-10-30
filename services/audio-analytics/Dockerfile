# Сервис «Аудиоаналитики»: API приёма записи + воркер разбора (start.sh).
# Контекст сборки — КОРЕНЬ монорепозитория (Coolify: Base Directory «/»,
# Dockerfile Location «/services/audio-analytics/Dockerfile»), поэтому пути
# ниже — от корня. Общий .dockerignore корня отсекает .env и прочее лишнее.
FROM python:3.12-slim

# ffmpeg — склейка сегментов и перекодирование для VAD; libsndfile ставится
# вместе с колесом soundfile.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    STORAGE_DIR=/data \
    VAD_MODEL_PATH=/opt/models/silero_vad.onnx \
    PORT=8000

WORKDIR /app
COPY services/audio-analytics/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY services/audio-analytics/app ./app
COPY services/audio-analytics/cli ./cli
COPY services/audio-analytics/start.sh ./start.sh

# Модель VAD скачивается при сборке образа, а не при первом разборе на сервере:
# иначе первый рабочий день зависел бы от доступности GitHub в тот момент.
RUN python -c "from app.pipeline.vad import download_model; download_model()" \
    && test -s "$VAD_MODEL_PATH"

# Аудио смен (STORAGE_BACKEND=local) и сборки приложения. В Coolify —
# постоянное хранилище на /data, иначе передеплой стирает все записи.
RUN mkdir -p /data
VOLUME /data

EXPOSE 8000
# Coolify ждёт «healthy» нового контейнера и только потом убирает старый.
# curl в slim-образе нет — проверка на самом Python.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)" || exit 1

CMD ["bash", "start.sh"]
