"""Organization and workspace management endpoints."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.config import settings
from app.db.database import get_db
from app.models.user import User
from app.models.organization import Organization, Workspace, OrganizationMember
from app.models.billing import Subscription
from app.auth.security import get_current_user

router = APIRouter(prefix="/orgs", tags=["Organizations"])


# ── Schemas ────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    description: Optional[str] = None


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict] = None


class OrgMemberResponse(BaseModel):
    id: str
    user_id: str
    email: str
    username: str
    role: str
    joined_at: str


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    description: Optional[str] = None


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class InviteMember(BaseModel):
    email: str
    role: str = "member"


# ── Helpers ────────────────────────────────────────────────

async def get_user_org(db: AsyncSession, user_id: str, org_id: str) -> Organization:
    result = await db.execute(
        select(Organization).join(OrganizationMember).where(
            Organization.id == org_id,
            OrganizationMember.user_id == user_id,
            Organization.is_active == True,
        )
    )
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found or access denied")
    return org


async def get_org_membership(db: AsyncSession, user_id: str, org_id: str) -> OrganizationMember:
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    return member


# ── Organizations ──────────────────────────────────────────

@router.get("/")
async def list_orgs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List organizations the current user belongs to."""
    result = await db.execute(
        select(Organization).join(OrganizationMember).where(
            OrganizationMember.user_id == current_user.id,
        ).order_by(Organization.created_at.desc())
    )
    orgs = result.scalars().all()
    out = []
    for org in orgs:
        member_result = await db.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == org.id,
                OrganizationMember.user_id == current_user.id,
            )
        )
        member = member_result.scalar_one()
        out.append({
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "description": org.description,
            "role": member.role,
            "member_count": len(org.members) if hasattr(org, "members") else 0,
            "created_at": org.created_at.isoformat(),
        })
    return out


@router.post("/")
async def create_org(
    data: OrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(select(Organization).where(Organization.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="An organization with this slug already exists")

    org = Organization(
        owner_id=current_user.id,
        name=data.name,
        slug=data.slug,
        description=data.description,
    )
    db.add(org)
    await db.flush()

    # Add creator as owner
    member = OrganizationMember(
        organization_id=org.id,
        user_id=current_user.id,
        role="owner",
    )
    db.add(member)

    # Create default workspace
    ws = Workspace(
        organization_id=org.id,
        name="General",
        slug="general",
        description="Default workspace",
        is_default=True,
    )
    db.add(ws)

    # Create free subscription
    sub = Subscription(organization_id=org.id, plan="free", status="active")
    db.add(sub)

    await db.commit()
    await db.refresh(org)

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "role": "owner",
        "created_at": org.created_at.isoformat(),
    }


@router.get("/{org_id}")
async def get_org(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = await get_user_org(db, current_user.id, org_id)
    member = await get_org_membership(db, current_user.id, org_id)

    ws_result = await db.execute(
        select(Workspace).where(Workspace.organization_id == org_id).order_by(Workspace.created_at)
    )
    workspaces = ws_result.scalars().all()

    members_result = await db.execute(
        select(OrganizationMember).where(OrganizationMember.organization_id == org_id)
    )
    members = members_result.scalars().all()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "logo_url": org.logo_url,
        "settings": org.settings or {},
        "role": member.role,
        "workspaces": [
            {"id": w.id, "name": w.name, "slug": w.slug, "is_default": w.is_default}
            for w in workspaces
        ],
        "members": [
            {"id": m.id, "user_id": m.user_id, "role": m.role, "joined_at": m.joined_at.isoformat()}
            for m in members
        ],
        "created_at": org.created_at.isoformat(),
    }


@router.patch("/{org_id}")
async def update_org(
    org_id: str,
    data: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = await get_user_org(db, current_user.id, org_id)
    member = await get_org_membership(db, current_user.id, org_id)
    if member.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can update the organization")

    if data.name is not None:
        org.name = data.name
    if data.description is not None:
        org.description = data.description
    if data.settings is not None:
        org.settings = data.settings

    await db.commit()
    await db.refresh(org)
    return {"status": "updated", "id": org.id}


@router.delete("/{org_id}")
async def delete_org(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = await get_user_org(db, current_user.id, org_id)
    if org.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can delete the organization")
    await db.delete(org)
    await db.commit()
    return {"status": "deleted"}


# ── Workspaces ─────────────────────────────────────────────

@router.post("/{org_id}/workspaces")
async def create_workspace(
    org_id: str,
    data: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_user_org(db, current_user.id, org_id)
    existing = await db.execute(
        select(Workspace).where(
            Workspace.organization_id == org_id,
            Workspace.slug == data.slug,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A workspace with this slug already exists")

    ws = Workspace(organization_id=org_id, name=data.name, slug=data.slug, description=data.description)
    db.add(ws)
    await db.commit()
    await db.refresh(ws)

    return {
        "id": ws.id,
        "name": ws.name,
        "slug": ws.slug,
        "description": ws.description,
        "is_default": ws.is_default,
        "created_at": ws.created_at.isoformat(),
    }


@router.patch("/{org_id}/workspaces/{ws_id}")
async def update_workspace(
    org_id: str, ws_id: str,
    data: WorkspaceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_user_org(db, current_user.id, org_id)
    result = await db.execute(
        select(Workspace).where(Workspace.id == ws_id, Workspace.organization_id == org_id)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if data.name is not None:
        ws.name = data.name
    if data.description is not None:
        ws.description = data.description
    await db.commit()
    return {"status": "updated"}


@router.delete("/{org_id}/workspaces/{ws_id}")
async def delete_workspace(
    org_id: str, ws_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_user_org(db, current_user.id, org_id)
    result = await db.execute(
        select(Workspace).where(Workspace.id == ws_id, Workspace.organization_id == org_id)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default workspace")
    await db.delete(ws)
    await db.commit()
    return {"status": "deleted"}


# ── Members ────────────────────────────────────────────────

@router.get("/{org_id}/members")
async def list_members(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_user_org(db, current_user.id, org_id)
    result = await db.execute(
        select(OrganizationMember, User).join(User, OrganizationMember.user_id == User.id).where(
            OrganizationMember.organization_id == org_id,
        )
    )
    rows = result.all()
    return [
        {
            "id": m.OrganizationMember.id,
            "user_id": m.User.id,
            "email": m.User.email,
            "username": m.User.username,
            "role": m.OrganizationMember.role,
            "joined_at": m.OrganizationMember.joined_at.isoformat(),
        }
        for m in rows
    ]


@router.post("/{org_id}/members")
async def invite_member(
    org_id: str,
    data: InviteMember,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = await get_user_org(db, current_user.id, org_id)
    member = await get_org_membership(db, current_user.id, org_id)
    if member.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can invite members")

    user_result = await db.execute(select(User).where(User.email == data.email))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User is already a member")

    new_member = OrganizationMember(organization_id=org_id, user_id=user.id, role=data.role)
    db.add(new_member)
    await db.commit()

    return {"status": "invited", "user_id": user.id, "email": user.email, "role": data.role}


@router.patch("/{org_id}/members/{member_id}")
async def update_member_role(
    org_id: str, member_id: str,
    role: str = Query(..., pattern=r"^(admin|member)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_user_org(db, current_user.id, org_id)
    actor = await get_org_membership(db, current_user.id, org_id)
    if actor.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can change roles")

    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.id == member_id,
            OrganizationMember.organization_id == org_id,
        )
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot change the owner's role")

    target.role = role
    await db.commit()
    return {"status": "updated", "member_id": member_id, "role": role}


@router.delete("/{org_id}/members/{member_id}")
async def remove_member(
    org_id: str, member_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_user_org(db, current_user.id, org_id)
    actor = await get_org_membership(db, current_user.id, org_id)
    if actor.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can remove members")

    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.id == member_id,
            OrganizationMember.organization_id == org_id,
        )
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove the owner")

    await db.delete(target)
    await db.commit()
    return {"status": "removed"}
