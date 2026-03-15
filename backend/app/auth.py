import logging
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from .database import get_db
from .config import get_settings
from .schemas import TokenData
from . import models

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.app_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[TokenData]:
    try:
        payload = jwt.decode(token, settings.app_secret_key, algorithms=[settings.jwt_algorithm])
        username: str = payload.get("sub")
        user_id: int = payload.get("uid")
        is_admin: bool = payload.get("admin", False)
        if username is None:
            return None
        return TokenData(username=username, user_id=user_id, is_admin=is_admin)
    except JWTError:
        return None


def authenticate_user(db: Session, username: str, password: str) -> Optional[models.User]:
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        return None
    if user.is_ldap:
        # Try LDAP authentication
        if not ldap_authenticate(username, password):
            return None
        return user
    if not user.hashed_password or not verify_password(password, user.hashed_password):
        return None
    return user


def ldap_authenticate(username: str, password: str) -> bool:
    if not settings.ldap_enabled:
        return False
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl

        tls = Tls(validate=ssl.CERT_NONE) if settings.ldap_tls else None
        server = Server(settings.ldap_server, port=settings.ldap_port, use_ssl=settings.ldap_tls, tls=tls, get_info=ALL)

        # Bind with service account
        conn = Connection(server, settings.ldap_bind_dn, settings.ldap_bind_password, auto_bind=True)

        # Find user DN
        user_filter = f"(&{settings.ldap_user_filter}({settings.ldap_username_attr}={username}))"
        conn.search(settings.ldap_base_dn, user_filter, attributes=[settings.ldap_username_attr, settings.ldap_email_attr])
        if not conn.entries:
            return False
        user_dn = conn.entries[0].entry_dn

        # Try to bind as the user
        user_conn = Connection(server, user_dn, password, auto_bind=True)
        if not user_conn.bound:
            return False

        # Check group membership if configured
        if settings.ldap_group_dn:
            conn.search(
                settings.ldap_group_dn,
                f"(member={user_dn})",
                search_scope=SUBTREE
            )
            if not conn.entries:
                return False

        return True
    except Exception as e:
        logger.error("LDAP auth error: %s", e)
        return False


def ldap_get_or_create_user(db: Session, username: str, password: str) -> Optional[models.User]:
    """For LDAP: authenticate and auto-create user if not exists."""
    if not settings.ldap_enabled:
        return None
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl

        tls = Tls(validate=ssl.CERT_NONE) if settings.ldap_tls else None
        server = Server(settings.ldap_server, port=settings.ldap_port, use_ssl=settings.ldap_tls, tls=tls, get_info=ALL)
        conn = Connection(server, settings.ldap_bind_dn, settings.ldap_bind_password, auto_bind=True)

        user_filter = f"(&{settings.ldap_user_filter}({settings.ldap_username_attr}={username}))"
        conn.search(settings.ldap_base_dn, user_filter, attributes=[settings.ldap_username_attr, settings.ldap_email_attr])
        if not conn.entries:
            return None

        entry = conn.entries[0]
        user_dn = entry.entry_dn
        email = str(getattr(entry, settings.ldap_email_attr, username + "@ldap.local"))

        # Bind as user to verify password
        user_conn = Connection(server, user_dn, password, auto_bind=True)
        if not user_conn.bound:
            return None

        # Check group membership
        if settings.ldap_group_dn:
            conn.search(settings.ldap_group_dn, f"(member={user_dn})", search_scope=SUBTREE)
            if not conn.entries:
                return None  # Not in required group

        # Get or create user
        user = db.query(models.User).filter(models.User.username == username).first()
        if not user:
            user = models.User(
                username=username,
                email=email,
                is_admin=False,
                is_ldap=True,
                max_vms=settings.default_max_vms,
                max_storage_gb=settings.default_max_storage_gb,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        return user
    except Exception as e:
        logger.error("LDAP get_or_create error: %s", e)
        return None


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    """Returns the current user. If user management is disabled, returns a synthetic admin."""
    from .config import get_settings
    settings = get_settings()

    if not settings.user_management:
        user = db.query(models.User).filter(models.User.is_admin == True).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No admin user found. Please complete initial setup.",
            )
        return user

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_data = decode_token(token)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(models.User).filter(models.User.id == token_data.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


async def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if not current_user or not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
