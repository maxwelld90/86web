import uuid as _uuid
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey,
    Text, JSON, Float
)
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    email = Column(String(256), unique=True, index=True, nullable=False)
    hashed_password = Column(String(256), nullable=True)  # Null for LDAP users
    is_admin = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_ldap = Column(Boolean, default=False, nullable=False)
    max_vms = Column(Integer, default=10, nullable=False)
    max_storage_gb = Column(Integer, default=100, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login = Column(DateTime, nullable=True)

    vms = relationship("VM", back_populates="owner", cascade="all, delete-orphan")
    groups = relationship("VMGroup", back_populates="owner", cascade="all, delete-orphan")


class VMGroup(Base):
    __tablename__ = "vm_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    description = Column(String(512), nullable=True)
    color = Column(String(16), default="#6366f1", nullable=False)
    network_enabled = Column(Boolean, default=False, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("User", back_populates="groups")
    vms = relationship("VM", back_populates="group")


class VM(Base):
    __tablename__ = "vms"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True, nullable=False, default=lambda: str(_uuid.uuid4()))
    name = Column(String(128), nullable=False)
    description = Column(String(512), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("vm_groups.id"), nullable=True)

    # Status: stopped | starting | running | paused | error
    status = Column(String(32), default="stopped", nullable=False)

    # Network (assigned by runner when VM starts)
    vnc_port = Column(Integer, nullable=True)
    ws_port = Column(Integer, nullable=True)

    # Full 86Box configuration stored as JSON
    config = Column(JSON, nullable=False, default=dict)

    # Disk usage in bytes (updated periodically)
    disk_usage_bytes = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_started = Column(DateTime, nullable=True)
    last_stopped = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates="vms")
    group = relationship("VMGroup", back_populates="vms")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(128), nullable=False)
    target = Column(String(256), nullable=True)
    detail = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
