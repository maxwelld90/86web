import uuid as _uuid
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey,
    Text, JSON, Float, Table
)
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

user_vm_access = Table(
    "user_vm_access",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("vm_id", Integer, ForeignKey("vms.id", ondelete="CASCADE"), primary_key=True)
)

user_group_access = Table(
    "user_group_access",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", Integer, ForeignKey("vm_groups.id", ondelete="CASCADE"), primary_key=True),
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    email = Column(String(256), unique=True, index=True, nullable=False)
    hashed_password = Column(String(256), nullable=True)
    is_admin = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_ldap = Column(Boolean, default=False, nullable=False)
    max_vms = Column(Integer, default=10, nullable=False)
    max_storage_gb = Column(Integer, default=100, nullable=False)
    
    can_manage_vms = Column(Boolean, default=True, nullable=False)
    can_manage_groups = Column(Boolean, default=True, nullable=False)
    can_access_library = Column(Boolean, default=True, nullable=False)
    can_upload_images = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login = Column(DateTime, nullable=True)

    # Existing Relations (User)
    vms = relationship("VM", foreign_keys="[VM.user_id]", back_populates="owner", cascade="all, delete-orphan")
    groups = relationship("VMGroup", back_populates="owner", cascade="all, delete-orphan")
    
    accessible_vms = relationship("VM", secondary=user_vm_access, back_populates="shared_with")
    accessible_groups = relationship("VMGroup", secondary=user_group_access, back_populates="shared_with")


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
    
    # NEW: With which group is this VM shared?
    shared_with = relationship("User", secondary=user_group_access, back_populates="accessible_groups")


class VM(Base):
    __tablename__ = "vms"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True, nullable=False, default=lambda: str(_uuid.uuid4()))
    name = Column(String(128), nullable=False)
    description = Column(String(512), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("vm_groups.id"), nullable=True)

    status = Column(String(32), default="stopped", nullable=False)

    # NEW: Concurrency Lock
    locked_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    vnc_port = Column(Integer, nullable=True)
    ws_port = Column(Integer, nullable=True)
    config = Column(JSON, nullable=False, default=dict)
    disk_usage_bytes = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_started = Column(DateTime, nullable=True)
    last_stopped = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates="vms", foreign_keys=[user_id])
    group = relationship("VMGroup", back_populates="vms")
    
    # NEW: Relations for lock and access
    locked_by = relationship("User", foreign_keys=[locked_by_user_id])
    shared_with = relationship("User", secondary=user_vm_access, back_populates="accessible_vms")


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
