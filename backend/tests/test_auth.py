"""Tests for auth security utilities."""
import pytest
from fastapi.exceptions import HTTPException
from app.auth.security import hash_password, verify_password, create_access_token, decode_token


class TestPasswordHashing:
    def test_hash_and_verify(self):
        pw = "MySecureP@ss123"
        hashed = hash_password(pw)
        assert hashed != pw
        assert verify_password(pw, hashed)
        assert not verify_password("WrongPass!", hashed)

    def test_unique_hashes(self):
        pw = "samepassword"
        h1 = hash_password(pw)
        h2 = hash_password(pw)
        assert h1 != h2


class TestTokens:
    def test_create_and_decode(self):
        data = {"sub": "42", "role": "student"}
        token = create_access_token(data)
        assert isinstance(token, str)
        decoded = decode_token(token)
        assert decoded["sub"] == "42"
        assert decoded["role"] == "student"

    def test_invalid_token(self):
        with pytest.raises(HTTPException):
            decode_token("invalid.jwt.here")
