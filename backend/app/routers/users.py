import os
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..auth import get_current_user, require_admin, hash_password
from ..models import User
from ..schemas import UserCreate, UserUpdate, UserResponse
from ..config import get_settings
from ..utils import dir_size

router = APIRouter(prefix="/api/users", tags=["users"])
settings = get_settings()


def _user_disk_usage(u: User) -> int:
    vm_usage = sum(dir_size(os.path.join(settings.vms_path, v.uuid)) for v in u.vms)
    return (
        vm_usage
        + dir_size(settings.user_images_path(u.id))
        + dir_size(settings.shared_media_path(u.id))
    )


@router.get("/", response_model=List[UserResponse])
async def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    users = db.query(User).all()
    result = []
    for u in users:
        resp = UserResponse.model_validate(u)
        resp.vm_count = len(u.vms)
        resp.disk_usage_bytes = _user_disk_usage(u)
        resp.is_bootstrap = (u.username == settings.admin_username)
        result.append(resp)
    return result


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(User).filter(
        (User.username == body.username) | (User.email == body.email)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username or email already exists")

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        is_admin=body.is_admin,
        is_active=body.is_active,
        max_vms=body.max_vms,
        max_storage_gb=body.max_storage_gb,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    resp = UserResponse.model_validate(user)
    resp.vm_count = 0
    resp.disk_usage_bytes = 0
    return resp


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    resp = UserResponse.model_validate(user)
    resp.vm_count = len(user.vms)
    resp.disk_usage_bytes = _user_disk_usage(user)
    resp.is_bootstrap = (user.username == settings.admin_username)
    return resp


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_bootstrap = (user.username == settings.admin_username)
    if is_bootstrap:
        if body.is_admin is False:
            raise HTTPException(status_code=400, detail="Cannot remove admin from the built-in admin account")
        if body.is_active is False:
            raise HTTPException(status_code=400, detail="Cannot deactivate the built-in admin account")

    if body.email is not None:
        user.email = body.email
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.max_vms is not None:
        user.max_vms = body.max_vms
    if body.max_storage_gb is not None:
        user.max_storage_gb = body.max_storage_gb
    if body.password:
        user.hashed_password = hash_password(body.password)

    db.commit()
    db.refresh(user)
    resp = UserResponse.model_validate(user)
    resp.vm_count = len(user.vms)
    resp.disk_usage_bytes = _user_disk_usage(user)
    resp.is_bootstrap = (user.username == settings.admin_username)
    return resp


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    if user.username == settings.admin_username:
        raise HTTPException(status_code=400, detail="Cannot delete the built-in admin account")
    db.delete(user)
    db.commit()
