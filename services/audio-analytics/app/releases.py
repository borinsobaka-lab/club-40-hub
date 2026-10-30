"""Сборки приложения записи: сравнение версий и версия из архива.

Приложение стоит на компьютерах в студиях, куда владелец не ходит. Раньше
обновление означало собрать сборку, принести её на флешке и обойти точки.
Теперь приложение само спрашивает у сервера, нет ли версии новее, и ставит её
по нажатию кнопки «Обновить».

Безопасность держится не на этом сервере. Каждая сборка подписана приватным
ключом владельца, а публичный ключ вшит в приложение: даже если ответ сервера
подменят, приложение не установит чужой архив — подпись не сойдётся. Поэтому
подпись хранится рядом со сборкой и отдаётся вместе с ней.
"""
import plistlib
import re
import tarfile
from typing import BinaryIO

PLATFORMS = ("darwin", "windows", "linux")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+")
# Версия попадает в ключ хранилища (app-releases/<платформа>/<версия>/…):
# только то, что безопасно в пути.
VERSION_SAFE_RE = re.compile(r"^[0-9A-Za-z.+-]{1,64}$")
MAX_ARCHIVE_MB = 300


def version_key(version: str) -> tuple:
    """Версия как кортеж чисел для сравнения: «0.10.0» новее «0.9.0».

    Сравнение строк здесь врёт именно на таком переходе, а это ровно тот
    момент, когда обновление молча перестанет приходить.
    """
    parts = re.split(r"[.\-+]", version.strip())
    numbers = []
    for part in parts:
        if part.isdigit():
            numbers.append(int(part))
        else:
            break
    return tuple(numbers) or (0,)


def valid_version(version: str) -> bool:
    return bool(VERSION_RE.match(version)) and bool(VERSION_SAFE_RE.match(version))


def version_from_archive(fileobj: BinaryIO) -> str | None:
    """Достать версию из Info.plist внутри .app.tar.gz.

    Версию можно было бы спрашивать у владельца полем в форме, но ошибка в
    ней ломает обновление незаметно: приложение будет либо считать себя
    новее сервера, либо ставить одно и то же по кругу. Пусть архив говорит
    за себя, а поле останется запасным вариантом (у сборок Windows и Linux
    Info.plist нет).
    """
    try:
        fileobj.seek(0)
        with tarfile.open(fileobj=fileobj, mode="r:gz") as tar:
            for member in tar:
                if not member.name.endswith("Contents/Info.plist") or not member.isfile():
                    continue
                if member.size > 1024 * 1024:
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    continue
                plist = plistlib.loads(handle.read())
                version = plist.get("CFBundleShortVersionString") or plist.get("CFBundleVersion")
                if version:
                    return str(version).strip()
    except Exception:  # noqa: BLE001 — битый архив не должен ронять загрузку
        return None
    finally:
        try:
            fileobj.seek(0)
        except Exception:  # noqa: BLE001
            pass
    return None
