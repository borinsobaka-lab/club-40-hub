"""Сравнение версий приложения — то, на чём молча ломается автообновление."""
import io
import plistlib
import tarfile

from app.releases import valid_version, version_from_archive, version_key


def test_newer_version_wins():
    assert version_key("0.2.0") > version_key("0.1.0")
    assert version_key("1.0.0") > version_key("0.9.9")


def test_double_digit_minor():
    """Строковое сравнение здесь врёт: «0.10.0» < «0.9.0» как текст. Это ровно
    тот переход, на котором обновления молча перестали бы приходить."""
    assert version_key("0.10.0") > version_key("0.9.0")
    assert version_key("0.2.10") > version_key("0.2.9")


def test_same_version_is_not_newer():
    assert not version_key("1.2.3") > version_key("1.2.3")


def test_suffix_is_ignored():
    """Хвосты вроде «1.2.3-beta» сравниваются по числовой части: свой релиз
    мы всё равно нумеруем тремя числами."""
    assert version_key("1.2.3-beta") == (1, 2, 3)


def test_garbage_does_not_crash():
    assert version_key("") == (0,)
    assert version_key("не версия") == (0,)


def make_archive(version: str | None) -> io.BytesIO:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        files = {"Audio Recorder.app/Contents/MacOS/app": b"\x00binary"}
        if version is not None:
            files["Audio Recorder.app/Contents/Info.plist"] = plistlib.dumps(
                {"CFBundleShortVersionString": version, "CFBundleVersion": "77"}
            )
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    buf.seek(0)
    return buf


def test_version_comes_from_info_plist():
    assert version_from_archive(make_archive("0.5.1")) == "0.5.1"


def test_archive_without_plist_or_broken_gives_none():
    assert version_from_archive(make_archive(None)) is None
    assert version_from_archive(io.BytesIO(b"not a tarball")) is None


def test_version_must_be_safe_for_storage_key():
    assert valid_version("1.2.3")
    assert valid_version("1.2.3-beta.1")
    assert not valid_version("1.2")
    assert not valid_version("1.2.3/../../x")
    assert not valid_version("1.2.3 beta")
