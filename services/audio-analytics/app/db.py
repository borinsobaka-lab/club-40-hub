"""Подключение к базе портала: синхронный SQLAlchemy (psycopg2).

Асинхронный драйвер прежнего проекта здесь не нужен: API отвечает
приложениям на ресепшенах и админке — десятки запросов в минуту, — а
воркер всё равно синхронный. Обработчики FastAPI объявлены обычными `def`
и выполняются в пуле потоков.

Фабрика сессий создаётся лениво и подменяется в тестах (set_session_factory):
тесты с базой заворачивают всю работу сервиса в одну транзакцию и в конце
откатывают её, чтобы общая тестовая база осталась чистой.
"""
from collections.abc import Callable, Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_engine: Engine | None = None
_factory: Callable[[], Session] | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            get_settings().sqlalchemy_url,
            # Соединение могло умереть за ночь простоя (перезапуск базы,
            # пулер) — проверяем перед выдачей, а не падаем на первом запросе.
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            pool_recycle=1800,
        )
    return _engine


def session_factory() -> Session:
    global _factory
    if _factory is None:
        _factory = sessionmaker(get_engine(), expire_on_commit=False)
    return _factory()


def set_session_factory(factory: Callable[[], Session] | None) -> None:
    """Подменить фабрику сессий (тесты). None — вернуть обычную."""
    global _factory
    _factory = factory


def get_db() -> Generator[Session, None, None]:
    """Зависимость FastAPI: сессия на запрос."""
    db = session_factory()
    try:
        yield db
    finally:
        db.close()
