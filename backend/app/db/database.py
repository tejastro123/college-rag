"""SQLAlchemy async database setup."""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
from app.core.logging import get_logger

# Handle both sqlite and postgres
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args=connect_args,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """Create all tables (for dev; production uses Alembic)."""
    from app.models import user, document, course, conversation
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed_admin() -> None:
    """Create default admin user if not exists."""
    from app.models.user import User
    from app.auth.security import hash_password
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
        if result.scalar_one_or_none():
            return
        admin = User(
            email=settings.ADMIN_EMAIL,
            username=settings.ADMIN_USERNAME,
            full_name=settings.ADMIN_FULL_NAME,
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
            role="admin",
            is_verified=True,
        )
        db.add(admin)
        await db.commit()
        logger = get_logger(__name__)
        logger.info("Admin user seeded", email=settings.ADMIN_EMAIL)
