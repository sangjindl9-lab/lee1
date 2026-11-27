"""파일 저장소. local 또는 S3 호환(Cloudflare R2 등)을 설정으로 교체한다."""
import os
import shutil

from .config import get_settings
from .security import make_token

_s = get_settings()


class LocalStorage:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        os.makedirs(self.root, exist_ok=True)

    def _p(self, key: str) -> str:
        p = os.path.abspath(os.path.join(self.root, key))
        if not p.startswith(self.root + os.sep):
            raise ValueError("잘못된 저장 경로")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def put_file(self, key: str, path: str) -> str:
        dst = self._p(key)
        if os.path.abspath(path) != dst:
            shutil.copyfile(path, dst)
        return key

    def put_bytes(self, key: str, data: bytes) -> str:
        with open(self._p(key), "wb") as f:
            f.write(data)
        return key

    def local_path(self, key: str) -> str:
        return self._p(key)

    def exists(self, key: str) -> bool:
        return os.path.exists(self._p(key))

    def delete(self, key: str) -> None:
        p = self._p(key)
        if os.path.exists(p):
            os.remove(p)


class S3Storage:
    def __init__(self):
        import boto3

        self.bucket = _s.s3_bucket
        self.client = boto3.client(
            "s3", endpoint_url=_s.s3_endpoint or None, aws_access_key_id=_s.s3_access_key,
            aws_secret_access_key=_s.s3_secret_key, region_name=_s.s3_region,
        )
        self.cache = os.path.abspath(os.path.join(_s.work_dir, "s3cache"))
        os.makedirs(self.cache, exist_ok=True)

    def put_file(self, key: str, path: str) -> str:
        self.client.upload_file(path, self.bucket, key)
        return key

    def put_bytes(self, key: str, data: bytes) -> str:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)
        return key

    def local_path(self, key: str) -> str:
        p = os.path.join(self.cache, key)
        if not os.path.exists(p):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            self.client.download_file(self.bucket, key, p)
        return p

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


_storage = None


def get_storage():
    global _storage
    if _storage is None:
        _storage = S3Storage() if _s.storage_backend == "s3" else LocalStorage(_s.storage_dir)
    return _storage


def file_url(key: str | None, hours: float = 12) -> str | None:
    """브라우저에서 <video>/<img>로 직접 열 수 있는 서명 URL."""
    if not key:
        return None
    return f"{_s.public_base_url}/api/files/{key}?t={make_token({'f': key}, hours)}"
