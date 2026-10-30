"""Общие настройки тестов.

Модульные тесты не ходят ни в сеть, ни в базу. Тесты с базой
(test_integration_db.py) запускаются, только если задан
TEST_SCHEMA_DATABASE_URL — база с полной схемой портала (её собирает
bash db/test/build-schema.sh <url> из корня репозитория).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import storage  # noqa: E402
from app.config import get_settings  # noqa: E402


@pytest.fixture
def configure(monkeypatch):
    """Задать переменные окружения сервиса на один тест (кэш настроек и
    хранилища сбрасывается до и после)."""

    def apply(**env):
        for key, value in env.items():
            monkeypatch.setenv(key.upper(), str(value))
        get_settings.cache_clear()
        storage.set_storage(None)
        return get_settings()

    yield apply
    get_settings.cache_clear()
    storage.set_storage(None)
