"""Integration tests for CollegeRAG API endpoints."""
import pytest


class TestHealth:
    async def test_health_endpoint(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"

    async def test_root_endpoint(self, client):
        resp = await client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "running"


class TestAuth:
    async def test_register(self, client):
        resp = await client.post("/api/v1/auth/register", json={
            "email": "new@example.com",
            "username": "newuser",
            "full_name": "New User",
            "password": "StrongPass1!",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == "new@example.com"

    async def test_register_duplicate(self, client):
        payload = {
            "email": "dup@example.com",
            "username": "dupuser",
            "full_name": "Dup User",
            "password": "StrongPass1!",
        }
        await client.post("/api/v1/auth/register", json=payload)
        resp = await client.post("/api/v1/auth/register", json=payload)
        assert resp.status_code == 400

    async def test_login(self, client):
        await client.post("/api/v1/auth/register", json={
            "email": "login@example.com",
            "username": "loginuser",
            "full_name": "Login User",
            "password": "StrongPass1!",
        })
        resp = await client.post("/api/v1/auth/login", json={
            "email": "login@example.com",
            "password": "StrongPass1!",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    async def test_login_wrong_password(self, client):
        await client.post("/api/v1/auth/register", json={
            "email": "wrong@example.com",
            "username": "wronguser",
            "full_name": "Wrong User",
            "password": "StrongPass1!",
        })
        resp = await client.post("/api/v1/auth/login", json={
            "email": "wrong@example.com",
            "password": "WrongPass!",
        })
        assert resp.status_code == 401

    async def test_me(self, client, auth_headers):
        resp = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["email"] == "test@example.com"


class TestDocuments:
    async def test_list_documents(self, client, auth_headers):
        resp = await client.get("/api/v1/documents/", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_upload_no_auth(self, client):
        resp = await client.post("/api/v1/documents/upload", files={"file": ("test.txt", b"hello")})
        assert resp.status_code == 401
