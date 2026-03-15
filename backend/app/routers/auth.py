from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..auth import (
    authenticate_user, ldap_get_or_create_user,
    create_access_token, get_current_user, hash_password
)
from ..models import User
from ..schemas import Token, LoginRequest, UserResponse
from ..config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


@router.post("/token", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    if not settings.user_management:
        # No auth needed — return a dummy token
        user = db.query(User).filter(User.is_admin == True).first()
        if not user:
            raise HTTPException(status_code=500, detail="No admin user configured")
        token = create_access_token({"sub": user.username, "uid": user.id, "admin": user.is_admin})
        return Token(access_token=token)

    # Try local auth first
    user = authenticate_user(db, form_data.username, form_data.password)

    # If not found locally and LDAP enabled, try LDAP auto-provision
    if not user and settings.ldap_enabled:
        user = ldap_get_or_create_user(db, form_data.username, form_data.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    user.last_login = datetime.utcnow()
    db.commit()

    token = create_access_token({"sub": user.username, "uid": user.id, "admin": user.is_admin})
    return Token(access_token=token)


@router.post("/login", response_model=Token)
async def login_json(
    req: LoginRequest,
    db: Session = Depends(get_db),
):
    """JSON login endpoint (alternative to form-based)."""
    if not settings.user_management:
        user = db.query(User).filter(User.is_admin == True).first()
        if not user:
            raise HTTPException(status_code=500, detail="No admin user configured")
        token = create_access_token({"sub": user.username, "uid": user.id, "admin": user.is_admin})
        return Token(access_token=token)

    user = authenticate_user(db, req.username, req.password)
    if not user and settings.ldap_enabled:
        user = ldap_get_or_create_user(db, req.username, req.password)

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    user.last_login = datetime.utcnow()
    db.commit()

    token = create_access_token({"sub": user.username, "uid": user.id, "admin": user.is_admin})
    return Token(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    vm_count = len(current_user.vms)
    disk_usage = sum(vm.disk_usage_bytes for vm in current_user.vms)
    resp = UserResponse.model_validate(current_user)
    resp.vm_count = vm_count
    resp.disk_usage_bytes = disk_usage
    return resp


@router.get("/config")
async def get_auth_config():
    """Public endpoint — tells the frontend whether auth is enabled."""
    return {
        "user_management": settings.user_management,
        "ldap_enabled": settings.ldap_enabled,
    }
