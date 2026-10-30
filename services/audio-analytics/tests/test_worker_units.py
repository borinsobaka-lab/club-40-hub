"""Воркер без базы: что можно стирать из очереди aa_storage_purge."""
import pytest

from app.worker import safe_purge_prefix


@pytest.mark.parametrize(
    "prefix",
    [
        "recordings/0f8fad5b-d9cb-469f-a165-70867728950e/",
        "app-releases/darwin/1.2.3/app.tar.gz",
        "app-releases/windows/0.10.0/",
    ],
)
def test_recording_and_release_prefixes_are_purged(prefix):
    assert safe_purge_prefix(prefix)


@pytest.mark.parametrize(
    "prefix",
    [
        "",
        "r",
        "recordings/",
        "recordings",
        "recordings/not-a-uuid/",
        "recordings/0f8fad5b-d9cb-469f-a165-70867728950e",  # без «/» задело бы и …950e-копия
        "app-releases/",
        "app-releases/darwin/",
        "app-releases/darwin/../../",
        "app-releases/beos/1.0.0/app.tar.gz",
        "/etc/",
    ],
)
def test_short_or_foreign_prefixes_are_refused(prefix):
    # Стирание по префиксу необратимо: «r» в S3 снесло бы всё, что на «r».
    assert not safe_purge_prefix(prefix)
