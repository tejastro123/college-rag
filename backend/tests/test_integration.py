"""Comprehensive integration tests for all API endpoints."""
import pytest


class TestHealth:
    async def test_health_endpoint(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"

    async def test_root_endpoint(self, client):
        resp = await client.get("/")
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"


class TestAuthFlow:
    """End-to-end auth: register → login → me → protected route → logout"""

    async def test_register_login_me(self, client):
        # Register
        r = await client.post("/api/v1/auth/register", json={
            "email": "flow@example.com", "username": "flowuser",
            "full_name": "Flow User", "password": "StrongPass1!",
        })
        assert r.status_code == 201
        token = r.json()["access_token"]
        assert r.json()["user"]["email"] == "flow@example.com"
        headers = {"Authorization": f"Bearer {token}"}

        # Me
        r = await client.get("/api/v1/auth/me", headers=headers)
        assert r.status_code == 200
        assert r.json()["email"] == "flow@example.com"

        # Login again
        r = await client.post("/api/v1/auth/login", json={
            "email": "flow@example.com", "password": "StrongPass1!",
        })
        assert r.status_code == 200

    async def test_protected_route_no_auth(self, client):
        r = await client.get("/api/v1/auth/me")
        assert r.status_code == 401

    async def test_invalid_token(self, client):
        r = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalid"})
        assert r.status_code == 401

    async def test_register_validation(self, client):
        r = await client.post("/api/v1/auth/register", json={
            "email": "bad", "username": "ab", "full_name": "x", "password": "short",
        })
        assert r.status_code == 422


class TestCourses:
    async def _auth(self, client, email="courses@test.com"):
        await client.post("/api/v1/auth/register", json={
            "email": email, "username": email.split("@")[0],
            "full_name": "Test User", "password": "TestPass123!",
        })
        r = await client.post("/api/v1/auth/login", json={"email": email, "password": "TestPass123!"})
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    async def test_create_course(self, client):
        headers = await self._auth(client)
        r = await client.post("/api/v1/courses/", json={
            "name": "Physics 101", "code": "PHY101",
            "description": "Intro to Physics", "semester": "Fall 2025",
        }, headers=headers)
        assert r.status_code == 201
        assert r.json()["name"] == "Physics 101"
        assert r.json()["role"] == "owner"

    async def test_list_courses(self, client):
        headers = await self._auth(client)
        # Create a course first
        await client.post("/api/v1/courses/", json={"name": "Math 101", "code": "MATH101"}, headers=headers)
        r = await client.get("/api/v1/courses/", headers=headers)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    async def test_join_course(self, client):
        headers1 = await self._auth(client, "owner@test.com")
        headers2 = await self._auth(client, "joiner@test.com")

        # Owner creates course with code
        r = await client.post("/api/v1/courses/", json={
            "name": "Shared Course", "code": "SHARE01",
        }, headers=headers1)
        assert r.status_code == 201

        # Joiner uses code to join
        r = await client.post("/api/v1/courses/join?code=SHARE01", headers=headers2)
        assert r.status_code == 200
        assert r.json()["name"] == "Shared Course"

        # Joiner sees the course in their list
        r = await client.get("/api/v1/courses/", headers=headers2)
        names = [c["name"] for c in r.json()]
        assert "Shared Course" in names

    async def test_course_members(self, client):
        headers = await self._auth(client, "courseowner@test.com")
        cr = await client.post("/api/v1/courses/", json={"name": "Team Course", "code": "TEAM01"}, headers=headers)
        course_id = cr.json()["id"]

        r = await client.get(f"/api/v1/courses/{course_id}/members", headers=headers)
        assert r.status_code == 200
        assert len(r.json()) == 1

    async def test_unauthorized_course_access(self, client):
        headers1 = await self._auth(client, "user_a@test.com")
        headers2 = await self._auth(client, "user_b@test.com")

        cr = await client.post("/api/v1/courses/", json={"name": "Private"}, headers=headers1)
        course_id = cr.json()["id"]

        r = await client.get(f"/api/v1/courses/{course_id}", headers=headers2)
        assert r.status_code == 404 or r.status_code == 403


class TestDocuments:
    async def _auth(self, client):
        await client.post("/api/v1/auth/register", json={
            "email": "doc@test.com", "username": "doctest",
            "full_name": "Doc Test", "password": "TestPass123!",
        })
        r = await client.post("/api/v1/auth/login", json={"email": "doc@test.com", "password": "TestPass123!"})
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    @pytest.mark.skip(reason="Background task DB session mismatch in test env")
    async def test_upload_and_list(self, client):
        headers = await self._auth(client)
        r = await client.post("/api/v1/documents/upload", headers=headers,
                              files={"file": ("test.txt", b"Hello World. " * 100, "text/plain")})
        assert r.status_code == 202
        data = r.json()
        assert data["status"] == "pending"
        assert "document_id" in data

    async def test_upload_unauthorized(self, client):
        r = await client.post("/api/v1/documents/upload",
                              files={"file": ("test.txt", b"hello")})
        assert r.status_code == 401


class TestSearch:
    async def _auth(self, client):
        await client.post("/api/v1/auth/register", json={
            "email": "search@test.com", "username": "searchtest",
            "full_name": "Search Test", "password": "TestPass123!",
        })
        r = await client.post("/api/v1/auth/login", json={"email": "search@test.com", "password": "TestPass123!"})
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    async def test_fulltext_search(self, client):
        headers = await self._auth(client)
        r = await client.get("/api/v1/search/?q=physics", headers=headers)
        assert r.status_code == 200

    @pytest.mark.skip(reason="Requires live internet access")
    async def test_web_search_endpoint(self, client):
        headers = await self._auth(client)
        r = await client.get("/api/v1/web-search/web?q=test+query&max_results=3", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["query"] == "test query"
        assert data["source"] == "web"
        assert "results" in data

    async def test_web_search_no_auth(self, client):
        r = await client.get("/api/v1/web-search/web?q=test")
        assert r.status_code == 401


class TestAdmin:
    async def _admin_auth(self, client, session):
        await client.post("/api/v1/auth/register", json={
            "email": "admin@test.com", "username": "admintest",
            "full_name": "Admin User", "password": "TestPass123!",
        })
        # Upgrade role to admin directly in DB
        from app.models.user import User
        from sqlalchemy import select
        result = await session.execute(select(User).where(User.email == "admin@test.com"))
        user = result.scalar_one_or_none()
        if user:
            user.role = "admin"
            await session.commit()
        r = await client.post("/api/v1/auth/login", json={"email": "admin@test.com", "password": "TestPass123!"})
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    async def test_admin_stats(self, client, session):
        headers = await self._admin_auth(client, session)
        r = await client.get("/api/v1/admin/stats", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "users" in data
        assert "documents" in data

    async def test_admin_users(self, client, session):
        headers = await self._admin_auth(client, session)
        r = await client.get("/api/v1/admin/users", headers=headers)
        assert r.status_code == 200
        assert "users" in r.json()

    async def test_admin_unauthorized(self, client):
        await client.post("/api/v1/auth/register", json={
            "email": "student@test.com", "username": "studenttest",
            "full_name": "Student", "password": "TestPass123!",
        })
        r = await client.post("/api/v1/auth/login", json={"email": "student@test.com", "password": "TestPass123!"})
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await client.get("/api/v1/admin/stats", headers=headers)
        assert r.status_code == 403
