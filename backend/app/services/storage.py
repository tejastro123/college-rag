"""Abstracted file storage — local disk or S3/MinIO."""
from __future__ import annotations

import io
import os
import aiofiles
from pathlib import Path
from typing import BinaryIO, Optional
from urllib.parse import urlparse

from app.core.config import settings


class StorageBackend:
    async def save(self, path: str, content: bytes) -> str:
        """Persist bytes, return the public URI."""
        raise NotImplementedError

    async def read(self, path: str) -> bytes:
        raise NotImplementedError

    async def delete(self, path: str) -> None:
        raise NotImplementedError

    async def exists(self, path: str) -> bool:
        raise NotImplementedError


class LocalStorage(StorageBackend):
    def __init__(self) -> None:
        self.root = Path(settings.UPLOAD_DIR)
        self.root.mkdir(parents=True, exist_ok=True)

    async def save(self, path: str, content: bytes) -> str:
        full = self.root / path
        full.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(full, "wb") as f:
            await f.write(content)
        return str(full)

    async def read(self, path: str) -> bytes:
        full = self.root / path
        async with aiofiles.open(full, "rb") as f:
            return await f.read()

    async def delete(self, path: str) -> None:
        full = self.root / path
        if full.exists():
            full.unlink()

    async def exists(self, path: str) -> bool:
        return (self.root / path).exists()


class S3Storage(StorageBackend):
    def __init__(self) -> None:
        import boto3

        self.client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        )
        self.bucket = settings.S3_BUCKET_NAME
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            self.client.create_bucket(Bucket=self.bucket)

    async def save(self, path: str, content: bytes) -> str:
        self.client.put_object(Bucket=self.bucket, Key=path, Body=content)
        endpoint = settings.S3_ENDPOINT.rstrip("/") if settings.S3_ENDPOINT else ""
        return f"{endpoint}/{self.bucket}/{path}"

    async def read(self, path: str) -> bytes:
        resp = self.client.get_object(Bucket=self.bucket, Key=path)
        return resp["Body"].read()

    async def delete(self, path: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=path)

    async def exists(self, path: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=path)
            return True
        except Exception:
            return False


def get_storage() -> StorageBackend:
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()


storage = get_storage()
