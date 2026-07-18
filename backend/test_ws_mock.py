import asyncio
from unittest.mock import AsyncMock, MagicMock
from app.api.v1.endpoints.admin import admin_ws_events
from app.db.database import AsyncSessionLocal
from sqlalchemy import select
from app.models.user import User

async def main():
    # Retrieve admin user to construct a valid token
    async with AsyncSessionLocal() as db:
        admin_user = (await db.execute(select(User).where(User.role == "admin"))).scalar()
        if not admin_user:
            print("No admin user found")
            return
        admin_id = admin_user.id
        print("Admin user ID:", admin_id)

    # Let's create a token
    from app.auth.security import create_access_token
    token = create_access_token({"sub": admin_id})

    # Create mock WebSocket
    ws = AsyncMock()
    ws.headers = {}
    ws.query_params = {"token": token}
    
    # We want to print everything sent via ws.send_json
    async def send_json(data):
        print("MOCK WS SEND:", data)
    ws.send_json = send_json
    
    # Run the handler
    try:
        await admin_ws_events(ws)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(main())
