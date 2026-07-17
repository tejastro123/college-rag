"""Locust load testing for CollegeRAG API.

Usage:
  locust -f locustfile.py --host=http://localhost:8001
  # Then open http://localhost:8089
"""
import time
from locust import HttpUser, task, between, events


class CollegeRAGUser(HttpUser):
    wait_time = between(1, 5)

    def on_start(self):
        """Register + login on start."""
        suffix = str(int(time.time() * 1000))[-6:]
        email = f"loadtest{suffix}@example.com"
        resp = self.client.post("/api/v1/auth/register", json={
            "email": email, "username": f"loaduser{suffix}",
            "full_name": f"Load Test {suffix}",
            "password": "TestPass123!",
        })
        if resp.status_code == 201:
            self.token = resp.json()["access_token"]
        else:
            resp = self.client.post("/api/v1/auth/login", json={
                "email": email, "password": "TestPass123!",
            })
            self.token = resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    @task(3)
    def health_check(self):
        self.client.get("/health")

    @task(2)
    def get_profile(self):
        self.client.get("/api/v1/auth/me", headers=self.headers)

    @task(2)
    def list_courses(self):
        self.client.get("/api/v1/courses/", headers=self.headers)

    @task(1)
    def create_course(self):
        suffix = str(int(time.time() * 1000))[-6:]
        self.client.post("/api/v1/courses/", json={
            "name": f"Load Test Course {suffix}",
            "code": f"LTC{suffix}",
        }, headers=self.headers)

    @task(1)
    def system_stats(self):
        self.client.get("/api/v1/system/stats", headers=self.headers)

    @task(1)
    def list_documents(self):
        self.client.get("/api/v1/documents/", headers=self.headers)
