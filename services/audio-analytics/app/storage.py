"""Хранилище аудио и сборок приложения: свой диск (local) или S3 (R2/MinIO).

Ключи — те же, что в прежнем проекте (recordings/<id>/seg_00000.opus,
merged.opus, transcript.json, app-releases/<платформа>/<версия>/app.tar.gz):
перенос из прежнего проекта копирует файлы как есть, а пути в базе не
переписываются.

По умолчанию — диск сервера (том /data в контейнере). Сервис стоит на том
же сервере, что и портал, а 60 дней записи нескольких студий — десятки
гигабайт; отдельный бакет со своей оплатой и ключами здесь не нужен.
Ссылки на файлы подписывает сам сервис (app/signing.py) и сам их раздаёт с
поддержкой Range — плеер админки перематывает 12-часовую запись, не скачивая
её целиком. S3 оставлен для тех, кто хочет держать аудио вне сервера.

Остальной код зовёт функции модуля (storage.upload_file, storage.get_bytes…),
как в прежнем проекте; какое хранилище за ними — решает STORAGE_BACKEND.
"""
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import BinaryIO, Protocol

from .config import get_settings
from .signing import make_token, validate_key


# --- Ключи ---------------------------------------------------------------------

def segment_key(recording_id: str, idx: int) -> str:
    return f"recordings/{recording_id}/seg_{idx:05d}.opus"


def merged_key(recording_id: str) -> str:
    return f"recordings/{recording_id}/merged.opus"


def transcript_key(recording_id: str) -> str:
    return f"recordings/{recording_id}/transcript.json"


def recording_prefix(recording_id: str) -> str:
    return f"recordings/{recording_id}/"


def release_key(platform: str, version: str) -> str:
    return f"app-releases/{platform}/{version}/app.tar.gz"


def content_type_for(key: str) -> str:
    """Тип файла по ключу — для отдачи с диска (S3 хранит его сам)."""
    if key.endswith(".opus") or key.endswith(".ogg"):
        # Chrome, Edge и Firefox играют Ogg Opus в <audio>; Safari — нет,
        # о чём предупреждает страница смены в админке.
        return "audio/ogg"
    if key.endswith(".json"):
        return "application/json"
    if key.endswith(".tar.gz") or key.endswith(".gz"):
        return "application/gzip"
    return "application/octet-stream"


class Storage(Protocol):
    backend: str

    def put_bytes(self, key: str, data: bytes, content_type: str = ...) -> str: ...
    def put_file(self, key: str, path: str, content_type: str = ...) -> str: ...
    def put_stream(self, key: str, stream: BinaryIO, content_type: str = ...) -> str: ...
    def download_file(self, key: str, path: str) -> str: ...
    def get_bytes(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def size(self, key: str) -> int | None: ...
    def delete(self, key: str) -> bool: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def signed_url(self, key: str, ttl_s: int) -> str: ...


# --- Свой диск -----------------------------------------------------------------

class LocalStorage:
    """Файлы под одной папкой (STORAGE_DIR); ключ — относительный путь.

    Запись атомарная: сначала во временный файл рядом, потом переименование.
    Приложение повторяет загрузку сегмента при обрыве, плеер в это время
    может читать файл — ни тот, ни другой не должны увидеть полфайла.
    """

    backend = "local"

    def __init__(self, root: str | os.PathLike, public_base: str = "", secret: str = ""):
        self.root = Path(root).resolve()
        self.public_base = public_base.rstrip("/")
        self.secret = secret

    def path_for(self, key: str) -> Path:
        """Путь к файлу ключа. Ключ проверяется по белому списку символов, а
        итоговый путь — что он внутри хранилища: выйти за его пределы
        («../», абсолютный путь, ссылка наружу) нельзя никаким ключом."""
        validate_key(key)
        path = (self.root / key).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValueError("недопустимый ключ")
        return path

    def _write_atomic(self, key: str, writer) -> str:
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".upload-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                writer(out)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return key

    def put_bytes(self, key: str, data: bytes, content_type: str = "") -> str:
        return self._write_atomic(key, lambda out: out.write(data))

    def put_file(self, key: str, path: str, content_type: str = "") -> str:
        def copy(out):
            with open(path, "rb") as src:
                shutil.copyfileobj(src, out, 1024 * 1024)

        return self._write_atomic(key, copy)

    def put_stream(self, key: str, stream: BinaryIO, content_type: str = "") -> str:
        return self._write_atomic(key, lambda out: shutil.copyfileobj(stream, out, 1024 * 1024))

    def download_file(self, key: str, path: str) -> str:
        src = self.path_for(key)
        if not src.is_file():
            raise FileNotFoundError(f"нет файла {key} в хранилище")
        shutil.copyfile(src, path)
        return path

    def get_bytes(self, key: str) -> bytes:
        src = self.path_for(key)
        if not src.is_file():
            raise FileNotFoundError(f"нет файла {key} в хранилище")
        return src.read_bytes()

    def exists(self, key: str) -> bool:
        return self.path_for(key).is_file()

    def size(self, key: str) -> int | None:
        path = self.path_for(key)
        return path.stat().st_size if path.is_file() else None

    def delete(self, key: str) -> bool:
        path = self.path_for(key)
        if not path.is_file():
            return False
        path.unlink()
        self._prune_empty_dirs(path.parent)
        return True

    def delete_prefix(self, prefix: str) -> int:
        """Удалить всё, чей ключ начинается с prefix — как в S3: и папку
        смены («recordings/<id>/»), и один архив сборки (полный ключ)."""
        if not prefix:
            raise ValueError("пустой префикс")
        base_key = prefix.rstrip("/")
        base = self.path_for(base_key)
        deleted = 0
        if prefix.endswith("/"):
            if base.is_dir():
                deleted = sum(1 for p in base.rglob("*") if p.is_file())
                shutil.rmtree(base)
                self._prune_empty_dirs(base.parent)
            return deleted
        # Префикс без «/» на конце: файлы в той же папке, чьё имя с него начинается.
        parent = base.parent
        if not parent.is_dir():
            return 0
        for path in sorted(parent.rglob("*"), reverse=True):
            rel = path.relative_to(self.root).as_posix()
            if not rel.startswith(prefix):
                continue
            if path.is_file():
                path.unlink()
                deleted += 1
            elif path.is_dir() and not any(path.iterdir()):
                path.rmdir()
        self._prune_empty_dirs(parent)
        return deleted

    def _prune_empty_dirs(self, start: Path) -> None:
        """Убрать опустевшие папки до корня хранилища — иначе за год на диске
        копятся тысячи пустых папок удалённых смен."""
        current = start
        while current != self.root and self.root in current.parents:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def signed_url(self, key: str, ttl_s: int) -> str:
        if not self.secret:
            raise RuntimeError("FILES_URL_SECRET не задан — ссылки на файлы подписать нечем")
        if not self.public_base:
            raise RuntimeError("PUBLIC_URL не задан — не из чего собрать адрес ссылки")
        token = make_token(key, int(time.time()) + int(ttl_s), self.secret)
        return f"{self.public_base}/files/{token}"


# --- S3 (Cloudflare R2, MinIO) -------------------------------------------------

def make_s3_client(endpoint_url: str, access_key: str, secret_key: str, region: str):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url or None,
        aws_access_key_id=access_key or None,
        aws_secret_access_key=secret_key or None,
        region_name=region,
        config=Config(signature_version="s3v4"),
    )


class S3Storage:
    backend = "s3"

    def __init__(self, client, bucket: str):
        self.client = client
        self.bucket = bucket

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        validate_key(key)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return key

    def put_file(self, key: str, path: str, content_type: str = "application/octet-stream") -> str:
        validate_key(key)
        self.client.upload_file(path, self.bucket, key, ExtraArgs={"ContentType": content_type})
        return key

    def put_stream(self, key: str, stream: BinaryIO, content_type: str = "application/octet-stream") -> str:
        validate_key(key)
        self.client.upload_fileobj(stream, self.bucket, key, ExtraArgs={"ContentType": content_type})
        return key

    def download_file(self, key: str, path: str) -> str:
        self.client.download_file(self.bucket, key, path)
        return path

    def get_bytes(self, key: str) -> bytes:
        resp = self.client.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read()

    def size(self, key: str) -> int | None:
        from botocore.exceptions import ClientError

        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return int(head.get("ContentLength") or 0)

    def exists(self, key: str) -> bool:
        return self.size(key) is not None

    def delete(self, key: str) -> bool:
        self.client.delete_object(Bucket=self.bucket, Key=key)
        return True

    def delete_prefix(self, prefix: str) -> int:
        """Delete every object under a prefix. Returns how many were removed."""
        if not prefix:
            raise ValueError("пустой префикс")
        deleted = 0
        token: str | None = None
        while True:
            kwargs = {"Bucket": self.bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = self.client.list_objects_v2(**kwargs)
            keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if keys:
                self.client.delete_objects(
                    Bucket=self.bucket, Delete={"Objects": keys, "Quiet": True}
                )
                deleted += len(keys)
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")
        return deleted

    def signed_url(self, key: str, ttl_s: int) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=int(ttl_s)
        )


# --- Выбор хранилища -----------------------------------------------------------

_storage: Storage | None = None


def build_storage(settings=None) -> Storage:
    settings = settings or get_settings()
    backend = settings.storage_backend.strip().lower()
    if backend == "local":
        return LocalStorage(settings.storage_dir, settings.public_base, settings.files_url_secret)
    if backend == "s3":
        client = make_s3_client(
            settings.s3_endpoint_url,
            settings.s3_access_key_id,
            settings.s3_secret_access_key,
            settings.s3_region,
        )
        return S3Storage(client, settings.s3_bucket)
    raise ValueError(f"STORAGE_BACKEND: неизвестное хранилище «{settings.storage_backend}» (local или s3)")


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = build_storage()
    return _storage


def set_storage(storage: Storage | None) -> None:
    """Подменить хранилище (тесты). None — собрать заново из настроек."""
    global _storage
    _storage = storage


# --- Функции модуля, как в прежнем проекте ---------------------------------------

def upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    return get_storage().put_bytes(key, data, content_type)


def upload_file(key: str, path: str, content_type: str = "application/octet-stream") -> str:
    return get_storage().put_file(key, path, content_type)


def download_file(key: str, path: str) -> str:
    return get_storage().download_file(key, path)


def get_bytes(key: str) -> bytes:
    return get_storage().get_bytes(key)


def delete_key(key: str) -> bool:
    return get_storage().delete(key)


def delete_prefix(prefix: str) -> int:
    return get_storage().delete_prefix(prefix)


def presigned_get_url(key: str, ttl_s: int | None = None) -> str:
    return get_storage().signed_url(key, ttl_s or get_settings().presigned_url_ttl_s)
