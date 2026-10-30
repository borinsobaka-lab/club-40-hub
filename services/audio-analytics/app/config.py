"""Настройки сервиса из переменных окружения (.env рядом — для запуска без Docker).

Всё, что касается разбора (модели, тарифы, VAD, экономия на запросах),
перенесено из прежнего проекта audio-analitics с теми же именами переменных:
значения из его .env можно переносить как есть. Новые здесь — хранилище
(свой диск или S3), подпись ссылок на файлы, проверка входа через Supabase и
срок хранения аудио, который теперь соблюдает сам сервис.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Адрес базы — к драйверу psycopg2.

    Строку подключения копируют из разных мест: Supabase и Coolify отдают
    «postgresql://» или «postgres://», в .env прежнего проекта стоял
    «postgresql+asyncpg://». SQLAlchemy понимает только явный драйвер, а
    «postgres://» не понимает вовсе — без этой правки сервис падал бы на
    старте из-за того, откуда скопировали адрес.
    """
    url = (url or "").strip()
    if not url:
        raise ValueError("DATABASE_URL не задан")
    scheme, sep, rest = url.partition("://")
    if not sep:
        raise ValueError("DATABASE_URL должен начинаться с postgresql:// или postgres://")
    scheme = scheme.lower()
    if scheme in ("postgres", "postgresql") or scheme.startswith("postgresql+"):
        return f"postgresql+psycopg2://{rest}"
    raise ValueError(f"DATABASE_URL: неподдерживаемая схема «{scheme}» — нужна база PostgreSQL")


def plain_database_url(url: str) -> str:
    """Тот же адрес для psycopg2 напрямую (без «+драйвер»): им пользуется
    перенос из прежнего проекта."""
    return normalize_database_url(url).replace("postgresql+psycopg2://", "postgresql://", 1)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Общее ---
    app_name: str = "Аудиоаналитика"
    environment: str = "production"  # development | production
    # Внешний адрес сервиса (https://audio.base40.fit). Из него строятся
    # ссылки на файлы при STORAGE_BACKEND=local: плеер админки и апдейтер
    # приложения получают абсолютный адрес.
    public_url: str = ""
    # Адреса админки через запятую — им разрешены запросы из браузера.
    cors_origins: str = ""

    # --- База (общая с порталом) ---
    database_url: str = ""

    # --- Хранилище аудио и сборок ---
    # local — файлы на диске контейнера (том /data), s3 — Cloudflare R2 /
    # MinIO / любое S3-совместимое, как в прежнем проекте.
    storage_backend: str = "local"
    storage_dir: str = "/data"
    # Ключ подписи ссылок /files/… для local. Без него раздавать файлы нельзя:
    # ссылка без подписи открывала бы любую запись любому, кто угадал путь.
    files_url_secret: str = ""
    # Сколько живёт ссылка на запись дня и на архив сборки.
    presigned_url_ttl_s: int = 3600

    s3_endpoint_url: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_bucket: str = "audio-analytics"
    s3_region: str = "auto"

    # --- Хранилище прежнего проекта (только для cli.import_legacy --copy-audio) ---
    old_s3_endpoint_url: str = ""
    old_s3_access_key_id: str = ""
    old_s3_secret_access_key: str = ""
    old_s3_bucket: str = "audio-analytics"
    old_s3_region: str = "auto"

    # --- Вход сотрудников (админка портала) ---
    # Токен из админки проверяет сам GoTrue: сервис спрашивает его
    # /auth/v1/user. Секрет JWT сервису не нужен — и не хранится.
    supabase_url: str = ""
    supabase_anon_key: str = ""

    # --- Приложение на ресепшене ---
    # Ключ приложения записи. Он один на всю сеть и вшит в сборку: точку
    # продажи сотрудник выбирает из списка, а не вводит ключ.
    app_key: str = ""
    # Предел одного сегмента. Пятиминутный Opus при 32 кбит/с — около 1,2 МБ;
    # запас на случай другой настройки записи, но не на мусор в гигабайты.
    max_segment_mb: int = 50

    # --- ASR: ElevenLabs Scribe ---
    elevenlabs_api_key: str = ""
    elevenlabs_model_id: str = "scribe_v2"

    # --- LLM: Anthropic Claude ---
    anthropic_api_key: str = ""
    # Stage 1 — деление смены на диалоги и итог дня, stage 2 — оценка по
    # метрикам. Haiku 5.5 в 20 раз дешевле Sonnet 5; если оценки по метрикам
    # окажутся слабее, достаточно вернуть Sonnet только на stage 2.
    llm_model_stage1: str = "claude-haiku-5-5"
    llm_model_stage2: str = "claude-haiku-5-5"
    # Current models think before answering, and max_tokens caps thinking plus
    # the answer together — too low a limit returns an empty response.
    llm_max_tokens: int = 16000
    # Сегментация дня идёт блоками, а не одним запросом на всю смену: блок
    # режется только по паузам длиннее conversation_gap_s и не превышает этого
    # числа символов транскрипта. Кириллица и грузинский токенизируются дорого,
    # поэтому 40 000 символов — это порядка 15–25 тыс. токенов на вход.
    llm_stage1_block_chars: int = 40_000
    # Все метрики диалога оцениваются одним запросом: диалог уходит в модель
    # один раз, а не по разу на метрику. Инструкции метрик набираются в запрос
    # до этого числа символов, остальные — следующим запросом: у Haiku 5.5
    # запрос длиннее 100 тыс. токенов стоит в пять раз дороже.
    llm_metrics_batch_chars: int = 60_000
    # Короче этого числа реплик диалог по метрикам не оценивается: в паре фраз
    # оценивать нечего, а платить за запрос приходится как за полный.
    llm_min_dialog_turns: int = 4
    # Сервисные разговоры (перенос, оплата, расписание действующего клиента)
    # по метрикам продаж не оцениваются. true — оценивать.
    llm_metrics_on_service: bool = False

    # --- Тарифы для подсчёта стоимости смены (USD) ---
    # ASR: цена часа аудио у вашего провайдера. ВАЖНО — значение по умолчанию
    # ориентировочное, поставьте фактическое из своего тарифа ElevenLabs,
    # иначе стоимость в админке будет выглядеть достоверно и врать.
    price_asr_per_hour_usd: float = 0.40
    # LLM: тарифы моделей Claude зашиты в pipeline/cost.py вместе с ценой
    # кэша. Эти два значения — цена за миллион токенов для модели, которой в
    # той таблице нет. По умолчанию — прайс Sonnet 5.
    price_llm_input_per_mtok_usd: float = 2.00
    price_llm_output_per_mtok_usd: float = 10.00

    # --- Разбор ---
    vad_threshold: float = 0.5
    vad_min_speech_ms: int = 250
    vad_min_silence_ms: int = 500
    # A pause longer than this (seconds) splits speech into separate conversations.
    conversation_gap_s: float = 30.0
    # Срок хранения аудио, дней (политика по закону о персональных данных).
    # Старше — сегменты и склеенная запись стираются, разбор и расшифровка
    # остаются. 0 — не стирать.
    audio_retention_days: int = 60
    # Разбор, статус которого не двигался дольше этого (секунды), считается
    # зависшим. Админка смотрит на то же правило в базе (aa_is_stale, 3 часа);
    # здесь — для счётчика в /api/staff/status.
    stale_processing_s: int = 3 * 3600

    # --- Воркер ---
    # Как часто пустая очередь проверяется снова.
    worker_poll_interval_s: float = 5.0
    # Сигнал жизни воркера в aa_service_state.
    worker_heartbeat_s: float = 30.0

    def problems(self) -> list[str]:
        """Чего не хватает для полной работы — пишется в журнал при старте.

        Сервис при этом запускается: приём записи с ресепшенов важнее всего
        остального, и он не должен ждать, пока впишут, скажем, ключ модели."""
        found = []
        if not self.app_key:
            found.append("APP_KEY не задан — приложения на ресепшенах не подключатся")
        backend = self.storage_backend.strip().lower()
        if backend == "local" and not self.files_url_secret:
            found.append("FILES_URL_SECRET не задан — плеер админки и обновления приложения не получат ссылок")
        elif backend == "local" and len(self.files_url_secret) < 32:
            found.append("FILES_URL_SECRET короче 32 знаков — сгенерируйте длинный случайный")
        if backend == "local" and not self.public_url:
            found.append("PUBLIC_URL не задан — не из чего собрать ссылки на файлы")
        if not self.supabase_url or not self.supabase_anon_key:
            found.append("SUPABASE_URL / SUPABASE_ANON_KEY не заданы — запросы админки отклоняются")
        if not self.asr_configured:
            found.append("ELEVENLABS_API_KEY не задан — разбор смен упадёт на распознавании")
        if not self.llm_configured:
            found.append("ANTHROPIC_API_KEY не задан — разбор смен упадёт на делении на разговоры")
        return found

    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        return normalize_database_url(self.database_url)

    @property
    def public_base(self) -> str:
        return self.public_url.strip().rstrip("/")

    @property
    def asr_configured(self) -> bool:
        return bool(self.elevenlabs_api_key)

    @property
    def llm_configured(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
