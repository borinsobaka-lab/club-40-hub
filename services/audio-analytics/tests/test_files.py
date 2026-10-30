"""Локальное хранилище и подписанные ссылки /files/{token}.

Здесь держится то, что легко сломать незаметно: подделанная или протухшая
ссылка не открывает файл, ключ не выводит за пределы хранилища, а плеер
админки может перематывать 12-часовую запись (Range → 206)."""
import time
import urllib.parse

import pytest
from fastapi.testclient import TestClient

from app import storage
from app.signing import TokenError, make_token, read_token, validate_key

SECRET = "test-secret-0123456789abcdef"


# --- токены ------------------------------------------------------------------------

def test_token_roundtrip():
    token = make_token("recordings/abc/merged.opus", int(time.time()) + 60, SECRET)
    assert read_token(token, SECRET) == "recordings/abc/merged.opus"
    # Токен — один сегмент пути, без символов, которые надо экранировать.
    assert urllib.parse.quote(token, safe="") == token.replace("=", "%3D")
    assert "/" not in token


def test_expired_token_is_rejected_as_expired():
    token = make_token("recordings/abc/merged.opus", 1000, SECRET)
    with pytest.raises(TokenError) as err:
        read_token(token, SECRET, now=1001)
    assert err.value.expired
    # До срока — ещё действует.
    assert read_token(token, SECRET, now=999) == "recordings/abc/merged.opus"


def test_tampered_token_is_rejected():
    token = make_token("recordings/abc/merged.opus", int(time.time()) + 60, SECRET)
    payload, sig = token.split(".")
    # Другой ключ файла с прежней подписью.
    forged_payload = make_token("recordings/xyz/merged.opus", int(time.time()) + 60, SECRET).split(".")[0]
    with pytest.raises(TokenError) as err:
        read_token(f"{forged_payload}.{sig}", SECRET)
    assert not err.value.expired
    # Продлённый срок с прежней подписью.
    longer = make_token("recordings/abc/merged.opus", int(time.time()) + 10**6, SECRET).split(".")[0]
    with pytest.raises(TokenError):
        read_token(f"{longer}.{sig}", SECRET)
    # Чужой ключ подписи и мусор.
    with pytest.raises(TokenError):
        read_token(token, "other-secret")
    for garbage in ("", "abc", "abc.def", "...", "%%%.###"):
        with pytest.raises(TokenError):
            read_token(garbage, SECRET)


def test_empty_secret_never_signs_or_verifies():
    with pytest.raises(TokenError):
        make_token("a/b", int(time.time()) + 60, "")
    token = make_token("a/b", int(time.time()) + 60, SECRET)
    with pytest.raises(TokenError):
        read_token(token, "")


@pytest.mark.parametrize(
    "key",
    [
        "../etc/passwd",
        "recordings/../../etc/passwd",
        "/etc/passwd",
        "recordings//x",
        "recordings/./x",
        "recordings\\x",
        "recordings/x\x00",
        "recordings/имя.opus",
        "recordings/a b.opus",
        "",
        "a" * 600,
    ],
)
def test_traversal_and_odd_keys_are_rejected(key):
    with pytest.raises(ValueError):
        validate_key(key)
    with pytest.raises((ValueError, TokenError)):
        make_token(key, int(time.time()) + 60, SECRET)


def test_signed_payload_with_bad_key_is_still_rejected():
    # Даже подписанный нашим ключом «../» не пройдёт: ключ проверяется и при чтении.
    import base64
    import hashlib
    import hmac

    payload = f"{int(time.time()) + 60}:../secret".encode()
    sig = hmac.new(SECRET.encode(), payload, hashlib.sha256).digest()
    enc = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    with pytest.raises(TokenError):
        read_token(f"{enc(payload)}.{enc(sig)}", SECRET)


# --- локальное хранилище -------------------------------------------------------------

def test_local_storage_cannot_escape_root(tmp_path):
    store = storage.LocalStorage(tmp_path / "data", "https://x", SECRET)
    (tmp_path / "secret.txt").write_text("top secret")
    with pytest.raises(ValueError):
        store.path_for("../secret.txt")
    with pytest.raises(ValueError):
        store.get_bytes("../secret.txt")
    # Симлинк наружу внутри хранилища тоже не выводит за его пределы.
    (tmp_path / "data" / "recordings").mkdir(parents=True)
    (tmp_path / "data" / "recordings" / "link").symlink_to(tmp_path)
    with pytest.raises(ValueError):
        store.path_for("recordings/link/secret.txt")


def test_local_storage_put_get_delete(tmp_path):
    store = storage.LocalStorage(tmp_path, "https://x", SECRET)
    store.put_bytes("recordings/r1/seg_00000.opus", b"one")
    store.put_bytes("recordings/r1/seg_00000.opus", b"two")  # повтор перезаписывает
    store.put_bytes("recordings/r1/transcript.json", b"{}")
    store.put_bytes("recordings/r2/seg_00000.opus", b"x")
    assert store.get_bytes("recordings/r1/seg_00000.opus") == b"two"
    assert store.size("recordings/r1/seg_00000.opus") == 3
    # Временных файлов от атомарной записи не остаётся.
    assert sorted(p.name for p in (tmp_path / "recordings" / "r1").iterdir()) == [
        "seg_00000.opus",
        "transcript.json",
    ]
    assert store.delete("recordings/r1/seg_00000.opus")
    assert not store.exists("recordings/r1/seg_00000.opus")
    assert store.exists("recordings/r1/transcript.json")
    # Папка смены целиком; соседняя смена не задета.
    assert store.delete_prefix("recordings/r1/") == 1
    assert not (tmp_path / "recordings" / "r1").exists()
    assert store.exists("recordings/r2/seg_00000.opus")


def test_local_delete_prefix_of_single_release(tmp_path):
    store = storage.LocalStorage(tmp_path, "https://x", SECRET)
    store.put_bytes("app-releases/darwin/1.0.0/app.tar.gz", b"a")
    store.put_bytes("app-releases/darwin/1.0.1/app.tar.gz", b"b")
    assert store.delete_prefix("app-releases/darwin/1.0.0/app.tar.gz") == 1
    assert not (tmp_path / "app-releases" / "darwin" / "1.0.0").exists()
    assert store.exists("app-releases/darwin/1.0.1/app.tar.gz")
    assert store.delete_prefix("app-releases/darwin/9.9.9/app.tar.gz") == 0


def test_signed_url_needs_public_url_and_secret(tmp_path):
    with pytest.raises(RuntimeError):
        storage.LocalStorage(tmp_path, "", SECRET).signed_url("a/b", 60)
    with pytest.raises(RuntimeError):
        storage.LocalStorage(tmp_path, "https://x", "").signed_url("a/b", 60)
    url = storage.LocalStorage(tmp_path, "https://audio.example/", SECRET).signed_url("a/b", 60)
    assert url.startswith("https://audio.example/files/")


# --- раздача файлов с Range ------------------------------------------------------------

@pytest.fixture
def files_client(tmp_path, configure):
    configure(storage_backend="local", storage_dir=tmp_path, files_url_secret=SECRET,
              public_url="https://audio.example")
    store = storage.LocalStorage(tmp_path, "https://audio.example", SECRET)
    storage.set_storage(store)
    from app.main import app

    return TestClient(app), store


def _path(url: str) -> str:
    return urllib.parse.urlparse(url).path


def test_file_endpoint_serves_full_file(files_client):
    client, store = files_client
    data = bytes(range(256)) * 400  # 100 КБ
    store.put_bytes("recordings/r1/merged.opus", data)
    resp = client.get(_path(store.signed_url("recordings/r1/merged.opus", 60)))
    assert resp.status_code == 200
    assert resp.content == data
    assert resp.headers["content-type"].startswith("audio/ogg")
    assert resp.headers["accept-ranges"] == "bytes"


def test_file_endpoint_supports_range_for_seeking(files_client):
    client, store = files_client
    data = bytes(range(256)) * 400
    store.put_bytes("recordings/r1/merged.opus", data)
    path = _path(store.signed_url("recordings/r1/merged.opus", 60))

    resp = client.get(path, headers={"Range": "bytes=1000-1999"})
    assert resp.status_code == 206
    assert resp.content == data[1000:2000]
    assert resp.headers["content-range"] == f"bytes 1000-1999/{len(data)}"
    assert resp.headers["content-length"] == "1000"

    # Открытый конец — так браузер просит «с этого места до конца».
    resp = client.get(path, headers={"Range": f"bytes={len(data) - 10}-"})
    assert resp.status_code == 206
    assert resp.content == data[-10:]

    # Хвост файла («последние 500 байт»): Ogg-плеер так ищет длительность.
    resp = client.get(path, headers={"Range": "bytes=-500"})
    assert resp.status_code == 206
    assert resp.content == data[-500:]

    # Диапазон за концом файла.
    resp = client.get(path, headers={"Range": f"bytes={len(data) + 10}-"})
    assert resp.status_code == 416


def test_file_endpoint_head(files_client):
    client, store = files_client
    store.put_bytes("recordings/r1/merged.opus", b"x" * 1234)
    resp = client.head(_path(store.signed_url("recordings/r1/merged.opus", 60)))
    assert resp.status_code == 200
    assert resp.headers["content-length"] == "1234"


def test_file_endpoint_rejects_bad_and_expired_tokens(files_client):
    client, store = files_client
    store.put_bytes("recordings/r1/merged.opus", b"x")
    good = store.signed_url("recordings/r1/merged.opus", 60).rsplit("/", 1)[-1]
    payload, sig = good.split(".")
    flipped = ("B" if sig[0] == "A" else "A") + sig[1:]
    assert client.get(f"/files/{payload}.{flipped}").status_code == 403
    expired = make_token("recordings/r1/merged.opus", int(time.time()) - 1, SECRET)
    resp = client.get(f"/files/{expired}")
    assert resp.status_code == 403
    assert "срок" in resp.json()["detail"]
    # Подпись верна, файла нет (стёрт по сроку хранения).
    gone = make_token("recordings/r9/merged.opus", int(time.time()) + 60, SECRET)
    assert client.get(f"/files/{gone}").status_code == 404
