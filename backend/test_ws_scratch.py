import asyncio
import websockets
import json

async def test_ws():
    # We can get a token by logging in via HTTP request or use a hardcoded login
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post("http://localhost:8001/api/v1/auth/login", json={
            "email": "admin@collegerag.com",
            "password": "admin123"
        })
        res_json = resp.json()
        print("Login response:", res_json)
        token = res_json.get("access_token") or res_json.get("token")

    uri = f"ws://localhost:8001/api/v1/admin/ws/events?token={token}"
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected!")
            while True:
                msg = await websocket.recv()
                print("Received:", msg)
    except Exception as e:
        print("Connection failed:", e)

asyncio.run(test_ws())
