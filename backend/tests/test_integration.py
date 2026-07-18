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

    async def test_admin_impersonate_user(self, client, session):
        headers = await self._admin_auth(client, session)
        # Create student user
        reg_resp = await client.post("/api/v1/auth/register", json={
            "email": "student_to_imp@test.com", "username": "studentimp",
            "full_name": "Student Imp", "password": "TestPass123!",
        })
        student_id = reg_resp.json()["user"]["id"]
        
        # Impersonate
        r = await client.post(f"/api/v1/admin/users/{student_id}/impersonate", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["user"]["email"] == "student_to_imp@test.com"

    async def test_admin_feature_flags(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # Create org
        from app.models.organization import Organization
        from app.models.user import User
        from sqlalchemy import select
        result = await session.execute(select(User).where(User.email == "admin@test.com"))
        admin_user = result.scalar_one()

        new_org = Organization(name="Test Org Flags", slug="test-org-flags", owner_id=admin_user.id)
        session.add(new_org)
        await session.commit()
        
        # Get flags
        r = await client.get(f"/api/v1/admin/organizations/{new_org.id}/feature-flags", headers=headers)
        assert r.status_code == 200
        flags = r.json()["feature_flags"]
        assert flags["enable_ocr"] is True
        
        # Update flags
        flags["enable_ocr"] = False
        r = await client.put(f"/api/v1/admin/organizations/{new_org.id}/feature-flags", json={"feature_flags": flags}, headers=headers)
        assert r.status_code == 200
        assert r.json()["feature_flags"]["enable_ocr"] is False

    async def test_admin_api_keys(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # Register a user to own the key
        reg_resp = await client.post("/api/v1/auth/register", json={
            "email": "key_owner@test.com", "username": "keyowner",
            "full_name": "Key Owner", "password": "TestPass123!",
        })
        owner_id = reg_resp.json()["user"]["id"]
        
        # Create API key
        r = await client.post("/api/v1/admin/api-keys", json={
            "name": "Test CLI Key", "owner_id": owner_id
        }, headers=headers)
        assert r.status_code == 200
        key_id = r.json()["id"]
        assert r.json()["name"] == "Test CLI Key"
        assert "raw_key" in r.json()
        
        # List API keys
        r = await client.get("/api/v1/admin/api-keys", headers=headers)
        assert r.status_code == 200
        names = [k["name"] for k in r.json()]
        assert "Test CLI Key" in names
        
        # Toggle API Key
        r = await client.put(f"/api/v1/admin/api-keys/{key_id}/toggle", headers=headers)
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        
        # Delete API Key
        r = await client.delete(f"/api/v1/admin/api-keys/{key_id}", headers=headers)
        assert r.status_code == 200

    async def test_admin_webhook_subscriptions(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # Create webhook
        r = await client.post("/api/v1/admin/webhook-subscriptions", json={
            "url": "https://test.com/hook", "event_types": ["document.ingested"]
        }, headers=headers)
        assert r.status_code == 200
        sub_id = r.json()["id"]
        assert r.json()["url"] == "https://test.com/hook"
        assert "secret" in r.json()
        
        # List webhooks
        r = await client.get("/api/v1/admin/webhook-subscriptions", headers=headers)
        assert r.status_code == 200
        urls = [w["url"] for w in r.json()]
        assert "https://test.com/hook" in urls
        
        # Toggle webhook
        r = await client.put(f"/api/v1/admin/webhook-subscriptions/{sub_id}/toggle", headers=headers)
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        
        # Delete webhook
        r = await client.delete(f"/api/v1/admin/webhook-subscriptions/{sub_id}", headers=headers)
        assert r.status_code == 200

    async def test_admin_role_permissions(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # Get permissions
        r = await client.get("/api/v1/admin/security/roles", headers=headers)
        assert r.status_code == 200
        assert "student" in r.json()
        
        # Update permissions
        matrix = r.json()
        matrix["student"] = ["documents:read"]
        r = await client.post("/api/v1/admin/security/roles", json={"matrix": matrix}, headers=headers)
        assert r.status_code == 200
        assert r.json()["matrix"]["student"] == ["documents:read"]

    async def test_admin_webhook_trigger_on_user_created(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # Create a webhook subscription for user.created
        r = await client.post("/api/v1/admin/webhook-subscriptions", json={
            "url": "https://mock-receiver.com/user-created",
            "event_types": ["user.created"]
        }, headers=headers)
        assert r.status_code == 200
        sub_id = r.json()["id"]

        # Mock the dispatch call and sessionmaker
        from unittest.mock import patch, AsyncMock
        from tests.conftest import TestSessionLocal
        with patch("app.services.event_bus.dispatch_webhook", new_callable=AsyncMock) as mock_dispatch, \
             patch("app.services.event_bus.AsyncSessionLocal", TestSessionLocal):
            
            # Now register a new user, which triggers "user.created" event
            await client.post("/api/v1/auth/register", json={
                "email": "webhook_triggered@test.com", "username": "webhookuser",
                "full_name": "Webhook User", "password": "TestPass123!",
            })
            
            # Wait a split second since the task runs asynchronously in asyncio task
            import asyncio
            await asyncio.sleep(0.2)
            
            # Verify mock was called
            assert mock_dispatch.called
            args, kwargs = mock_dispatch.call_args
            assert args[0] == "https://mock-receiver.com/user-created"
            assert args[2]["event"] == "user.created"
            assert args[2]["data"]["email"] == "webhook_triggered@test.com"

        # Clean up webhook
        await client.delete(f"/api/v1/admin/webhook-subscriptions/{sub_id}", headers=headers)

    async def test_admin_lifecycle_retention(self, client, session):
        headers = await self._admin_auth(client, session)
        
        from unittest.mock import patch
        from tests.conftest import TestSessionLocal
        with patch("app.api.v1.endpoints.lifecycle.AsyncSessionLocal", TestSessionLocal):
            # 1. Create a retention policy
            r = await client.post("/api/v1/admin/lifecycle/retention", json={
                "policy_type": "document_age",
                "retention_days": 15,
                "action": "archive",
                "is_active": True
            }, headers=headers)
            assert r.status_code == 200
            policy_id = r.json()["id"]
            assert r.json()["retention_days"] == 15
            
            # 2. List retention policies
            r = await client.get("/api/v1/admin/lifecycle/retention", headers=headers)
            assert r.status_code == 200
            assert len(r.json()) > 0
            
            # 3. Trigger manual cleanup background task
            r = await client.post("/api/v1/admin/lifecycle/retention/cleanup/trigger", headers=headers)
            assert r.status_code == 200
            assert r.json()["status"] == "cleanup_triggered"
            
            # 4. Delete policy
            r = await client.delete(f"/api/v1/admin/lifecycle/retention/{policy_id}", headers=headers)
            assert r.status_code == 200
            assert r.json()["status"] == "deleted"


    async def test_admin_lifecycle_backup_restore(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # 1. Trigger backup
        r = await client.post("/api/v1/admin/lifecycle/backups", headers=headers)
        assert r.status_code == 200
        backup_id = r.json()["id"]
        filename = r.json()["filename"]
        
        # 2. List backups
        r = await client.get("/api/v1/admin/lifecycle/backups", headers=headers)
        assert r.status_code == 200
        assert any(b["id"] == backup_id for b in r.json())
        
        # 3. Restore backup
        r = await client.post(f"/api/v1/admin/lifecycle/backups/{backup_id}/restore", headers=headers)
        assert r.status_code == 200
        assert r.json()["status"] == "restored"
        assert r.json()["filename"] == filename

        # Clean up backup file on disk
        import os
        from app.api.v1.endpoints.lifecycle import BACKUP_DIR
        try:
            os.remove(BACKUP_DIR / filename)
        except Exception:
            pass

    async def test_admin_lifecycle_gdpr(self, client, session):
        headers = await self._admin_auth(client, session)
        
        from unittest.mock import patch
        from tests.conftest import TestSessionLocal
        with patch("app.api.v1.endpoints.lifecycle.AsyncSessionLocal", TestSessionLocal):
            # Create a test user for GDPR request
            from sqlalchemy import select
            from app.models.user import User
            admin_user = (await session.execute(select(User).where(User.role == "admin"))).scalar_one()
            
            # 1. Submit GDPR Export request
            r = await client.post("/api/v1/admin/lifecycle/gdpr", json={
                "user_email": admin_user.email,
                "request_type": "export"
            }, headers=headers)
            assert r.status_code == 200
            req_id = r.json()["id"]
            assert r.json()["status"] == "processing"
            
            # Wait a moment for background task
            import asyncio
            await asyncio.sleep(0.5)
            
            # Check list of GDPR requests
            r = await client.get("/api/v1/admin/lifecycle/gdpr", headers=headers)
            assert r.status_code == 200
            req_list = r.json()
            assert any(req["id"] == req_id for req in req_list)
            
            # 2. Submit GDPR Delete request
            # Register a temporary user to be deleted so we don't touch the admin user
            await client.post("/api/v1/auth/register", json={
                "email": "gdpr_delete_me@test.com", "username": "gdprdelete",
                "full_name": "GDPR Delete", "password": "TestPass123!",
            })
            r = await client.post("/api/v1/admin/lifecycle/gdpr", json={
                "user_email": "gdpr_delete_me@test.com",
                "request_type": "delete"
            }, headers=headers)
            assert r.status_code == 200
            delete_req_id = r.json()["id"]
            
            await asyncio.sleep(0.5)
            
            # Check user is anonymized in DB
            result = await session.execute(select(User).where(User.email == "gdpr_delete_me@test.com"))
            deleted_user = result.scalar_one_or_none()
            assert deleted_user is None or deleted_user.is_active == False


    async def test_admin_lifecycle_archive_restore(self, client, session):
        headers = await self._admin_auth(client, session)
        
        # Create a test document and chunk
        from app.models.document import Document, Chunk
        from sqlalchemy import select
        from app.models.user import User
        admin_user = (await session.execute(select(User).where(User.role == "admin"))).scalar_one()
        
        doc = Document(
            owner_id=admin_user.id,
            filename="lifecycle_test.txt",
            original_filename="lifecycle_test.txt",
            file_path="lifecycle_test.txt",
            file_type="txt",
            status="indexed"
        )
        session.add(doc)
        await session.commit()
        await session.refresh(doc)
        
        chunk = Chunk(
            document_id=doc.id,
            content="This is some content for data lifecycle test.",
            chunk_type="text",
            page_number=1
        )
        session.add(chunk)
        await session.commit()
        await session.refresh(chunk)
        
        # 1. Archive document
        r = await client.post(f"/api/v1/admin/lifecycle/documents/{doc.id}/archive", headers=headers)
        assert r.status_code == 200
        assert r.json()["status"] == "archived"
        
        # Verify status in database
        await session.refresh(doc)
        assert doc.status == "archived"
        
        # Mock vector store add documents call during restore
        from unittest.mock import patch, AsyncMock
        with patch("app.embeddings.vector_store.VectorStore.add_documents", new_callable=AsyncMock) as mock_add:
            # 2. Restore document
            r = await client.post(f"/api/v1/admin/lifecycle/documents/{doc.id}/restore", headers=headers)
            assert r.status_code == 200
            assert r.json()["status"] == "restored"
            assert mock_add.called
            
            # Verify status in database
            await session.refresh(doc)
            assert doc.status == "indexed"

        # Cleanup
        await session.delete(chunk)
        await session.delete(doc)
        await session.commit()

    async def test_admin_search_tuning(self, client, session):
        headers = await self._admin_auth(client, session)

        # 1. Get tuning settings
        r = await client.get("/api/v1/admin/search/tuning", headers=headers)
        assert r.status_code == 200
        tuning = r.json()
        assert "hybrid_alpha" in tuning
        assert tuning["hybrid_alpha"] == 0.5

        # 2. Update tuning settings
        r = await client.post("/api/v1/admin/search/tuning", json={
            "hybrid_alpha": 0.8,
            "query_expansion_enabled": False,
            "hyde_enabled": False,
            "rerank_enabled": True,
            "rerank_top_k": 8,
            "retrieval_top_k": 15
        }, headers=headers)
        assert r.status_code == 200
        assert r.json()["ok"] is True

        # 3. Verify settings updated
        r = await client.get("/api/v1/admin/search/tuning", headers=headers)
        assert r.status_code == 200
        tuning = r.json()
        assert tuning["hybrid_alpha"] == 0.8
        assert tuning["query_expansion_enabled"] is False
        assert tuning["rerank_top_k"] == 8

        # 4. Try updating with invalid payload (out of range alpha)
        r = await client.post("/api/v1/admin/search/tuning", json={
            "hybrid_alpha": 1.5,
            "query_expansion_enabled": True,
            "hyde_enabled": True,
            "rerank_enabled": True,
            "rerank_top_k": 5,
            "retrieval_top_k": 10
        }, headers=headers)
        assert r.status_code == 422

    async def test_admin_search_metrics_and_clicks(self, client, session):
        headers = await self._admin_auth(client, session)

        # Log a fake search query
        from app.services.search_tuning import log_search_query
        from app.models.user import User
        from sqlalchemy import select
        admin_user = (await session.execute(select(User).where(User.role == "admin"))).scalar_one()

        log_id = await log_search_query(session, "what is machine learning", user_id=admin_user.id, session_id="test_session_123")
        assert log_id is not None

        # Verify query exists in analytics
        from app.models.search_tuning import SearchAnalytics
        db_analytics = (await session.execute(select(SearchAnalytics).where(SearchAnalytics.id == log_id))).scalar_one()
        assert db_analytics.clicked is False

        # Record a click
        r = await client.post("/api/v1/search/click", json={
            "message_id": log_id,
            "click_rank": 2
        }, headers=headers)
        assert r.status_code == 200
        assert r.json()["ok"] is True

        # Check metrics
        r = await client.get("/api/v1/admin/search/metrics", headers=headers)
        assert r.status_code == 200
        metrics = r.json()
        assert metrics["total_queries"] >= 1
        assert metrics["click_through_rate"] > 0.0
        assert metrics["average_click_rank"] == 2.0

    async def test_admin_search_drift(self, client, session):
        headers = await self._admin_auth(client, session)

        # Retrieve drift - will return insufficient data because vector store has no chunks yet
        r = await client.get("/api/v1/admin/search/drift", headers=headers)
        assert r.status_code == 200
        drift = r.json()
        assert "drift_score" in drift
        assert drift["status"] in ["insufficient_data", "stable", "no_embeddings_found"]

    async def test_admin_compliance_audit_export(self, client, session):
        headers = await self._admin_auth(client, session)

        # 1. Test audit export JSON
        r = await client.get("/api/v1/admin/compliance/audit/export?format=json", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "export_metadata" in data
        assert "records" in data

        # 2. Test audit export CSV
        r = await client.get("/api/v1/admin/compliance/audit/export?format=csv", headers=headers)
        assert r.status_code == 200
        assert "text/csv" in r.headers["content-type"]

    async def test_admin_compliance_data_residency(self, client, session):
        headers = await self._admin_auth(client, session)

        # 1. Get residency configs
        r = await client.get("/api/v1/admin/compliance/residency", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

        # 2. Update residency configuration
        r = await client.post("/api/v1/admin/compliance/residency?enforce_strict=true", json=["US", "EU"], headers=headers)
        assert r.status_code == 200
        res = r.json()
        assert res["allowed_regions"] == ["US", "EU"]
        assert res["enforce_strict"] is True

    async def test_admin_compliance_key_rotation(self, client, session):
        headers = await self._admin_auth(client, session)

        # 1. Get encryption keys
        r = await client.get("/api/v1/admin/compliance/keys", headers=headers)
        assert r.status_code == 200
        keys = r.json()
        assert len(keys) >= 1

        # 2. Rotate keys
        r = await client.post("/api/v1/admin/compliance/keys/rotate", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "success"
        assert "new_key" in data
        assert data["new_key"]["version"] >= 2



