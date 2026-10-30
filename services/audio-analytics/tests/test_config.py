"""Адрес базы из разных источников приводится к драйверу psycopg2."""
import pytest

from app.config import normalize_database_url, plain_database_url


@pytest.mark.parametrize(
    "raw",
    [
        "postgres://u:p@db:5432/postgres",
        "postgresql://u:p@db:5432/postgres",
        "postgresql+asyncpg://u:p@db:5432/postgres",
        "postgresql+psycopg2://u:p@db:5432/postgres",
        "  POSTGRESQL://u:p@db:5432/postgres  ",
    ],
)
def test_any_postgres_url_gets_psycopg2_driver(raw):
    assert normalize_database_url(raw) == "postgresql+psycopg2://u:p@db:5432/postgres"


def test_query_string_is_kept():
    url = "postgres://u:p@db:6543/postgres?sslmode=require"
    assert normalize_database_url(url).endswith("/postgres?sslmode=require")
    assert plain_database_url(url) == "postgresql://u:p@db:6543/postgres?sslmode=require"


@pytest.mark.parametrize("raw", ["", "   ", "mysql://u:p@db/x", "db:5432/postgres"])
def test_bad_urls_are_rejected_with_clear_error(raw):
    with pytest.raises(ValueError):
        normalize_database_url(raw)
